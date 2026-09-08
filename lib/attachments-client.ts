"use client";

import { apiFetch, postJson } from "@/lib/query/api";
import { createClient } from "@/lib/supabase/client";
import { selectAllPages } from "@/lib/supabase/pagination";
import {
  ATTACHMENTS_BUCKET,
  CARD_ATTACHMENT_COLUMNS,
} from "@/lib/attachments/types";
import type { CardAttachment, LibraryAttachment } from "@/lib/types";

const MAX_IMAGE_DIMENSION = 1568;

export class UploadAbortedError extends Error {
  constructor() {
    super("Upload cancelled");
    this.name = "UploadAbortedError";
  }
}

export type Upload = {
  promise: Promise<CardAttachment>;
  abort: () => void;
};

type SignedUpload = { id: string; signedUrl: string; mimeType: string };

// XMLHttpRequest, not fetch: a fetch body can only report upload progress
// through `duplex: "half"` streaming, which is Chromium-over-HTTP/2 only.
function putSigned(
  xhr: XMLHttpRequest,
  signed: SignedUpload,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    xhr.open("PUT", signed.signedUrl);
    // What uploadToSignedUrl sends for a raw body. The token in the URL is what
    // authorises the write; the anon key only gets the request past the gateway.
    xhr.setRequestHeader("content-type", signed.mimeType);
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      let message = `Upload failed (${xhr.status})`;
      try {
        const body = JSON.parse(xhr.responseText) as { message?: string };
        if (body.message) message = body.message;
      } catch {
        // Storage answers with JSON; anything else keeps the status.
      }
      reject(new Error(message));
    });
    xhr.addEventListener("error", () =>
      reject(new Error("Network error — the upload never reached storage.")),
    );
    xhr.addEventListener("abort", () => reject(new UploadAbortedError()));
    xhr.send(file);
  });
}

// Three steps, because the bytes go straight to storage: sign, put, record.
// Routing them through the API instead capped an upload at the host's request
// body limit, which is well under what the file kinds allow.
export function uploadAttachment({
  file,
  conversationId,
  onProgress,
}: {
  file: File;
  conversationId: string;
  onProgress: (fraction: number) => void;
}): Upload {
  const xhr = new XMLHttpRequest();
  let aborted = false;

  const promise = (async () => {
    const signed = await apiFetch<SignedUpload>(
      "/api/attachments/upload-url",
      postJson({
        conversationId,
        filename: file.name,
        mimeType: file.type,
        size: file.size,
      }),
    );
    // An abort before open() has nothing to cancel; the sweep reclaims an
    // object left behind by one that lands between the put and the record.
    if (aborted) throw new UploadAbortedError();

    await putSigned(xhr, signed, file, onProgress);
    if (aborted) throw new UploadAbortedError();

    const { attachment } = await apiFetch<{ attachment: CardAttachment }>(
      "/api/attachments",
      postJson({
        conversationId,
        id: signed.id,
        filename: file.name,
        mimeType: file.type,
      }),
    );
    // A cancel landing here found no attachment id on the draft to delete, and
    // the record cannot be called off once the request is away — so it is undone
    // rather than aborted.
    if (aborted) {
      await deleteAttachment(attachment.id).catch(() => {});
      throw new UploadAbortedError();
    }
    return attachment;
  })();

  return {
    promise,
    abort: () => {
      aborted = true;
      xhr.abort();
    },
  };
}

export async function createConversation(): Promise<string> {
  const { id } = await apiFetch<{ id: string }>(
    "/api/conversations",
    postJson({}),
  );
  return id;
}

const LIBRARY_LIMIT = 200;

// Claimed files only: a draft is either a chip in the composer right now or one
// the sweep is about to reclaim, and neither is worth offering back.
export async function fetchAttachmentLibrary(): Promise<LibraryAttachment[]> {
  const { data, error } = await createClient()
    .from("attachments")
    .select(`${CARD_ATTACHMENT_COLUMNS}, conversations(title)`)
    .not("node_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(LIBRARY_LIMIT);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as (CardAttachment & {
    conversations: { title: string } | null;
  })[];

  // The whole point of the picker is the file sent five times over; it is one
  // entry, and the newest row is the one that gets copied.
  const seen = new Set<string>();
  const library: LibraryAttachment[] = [];
  for (const row of rows) {
    const key = `${row.filename}\u0000${row.byte_size}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { conversations, ...attachment } = row;
    library.push({
      ...attachment,
      conversation_title: conversations?.title ?? null,
    });
  }
  return library;
}

// Answered positionally: one new draft per id, in the order asked for.
export async function reuseAttachments(
  conversationId: string,
  ids: string[],
): Promise<CardAttachment[]> {
  const { attachments } = await apiFetch<{ attachments: CardAttachment[] }>(
    "/api/attachments/reuse",
    postJson({ conversationId, ids }),
  );
  return attachments;
}

export async function deleteAttachment(id: string): Promise<void> {
  await apiFetch(`/api/attachments?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// Must run before the rows go: the row is the only record of the path, and the
// delete cascades it away. Paths first, delete, then removeAttachmentObjects.
export async function attachmentObjectPaths(
  scope: { nodeIds: string[] } | { conversationId: string },
): Promise<string[]> {
  const supabase = createClient();
  const { rows, error } = await selectAllPages((from, to) => {
    const query = supabase
      .from("attachments")
      .select("storage_path")
      .order("storage_path")
      .range(from, to);
    return "nodeIds" in scope
      ? query.in("node_id", scope.nodeIds)
      : query.eq("conversation_id", scope.conversationId);
  });
  if (error) {
    console.warn("Could not list attachment objects to remove:", error.message);
  }
  return rows.map((row) => row.storage_path);
}

// Logged rather than thrown: losing a delete because storage hiccuped would be
// worse than the leak, which the sweep reclaims anyway.
export async function removeAttachmentObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await createClient()
    .storage.from(ATTACHMENTS_BUCKET)
    .remove(paths);
  if (error) {
    console.warn("Could not remove attachment objects:", error.message);
  }
}

const swept = new Set<string>();

export function sweepAttachments(conversationId: string): void {
  if (swept.has(conversationId)) return;
  swept.add(conversationId);
  void apiFetch("/api/attachments/sweep", postJson({ conversationId })).catch(
    () => {},
  );
}

export async function fetchAttachmentUrls(
  ids: string[],
): Promise<Record<string, string>> {
  const { urls } = await apiFetch<{ urls: Record<string, string> }>(
    "/api/attachments/urls",
    postJson({ ids }),
  );
  return urls;
}

// GIFs are excluded because re-encoding drops every frame after the first.
export function isResizable(file: File): boolean {
  return file.type.startsWith("image/") && file.type !== "image/gif";
}

export async function downscaleImage(file: File): Promise<File> {
  if (!isResizable(file)) return file;
  if (typeof createImageBitmap !== "function") return file;
  if (typeof OffscreenCanvas === "undefined") return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= MAX_IMAGE_DIMENSION) return file;

    const scale = MAX_IMAGE_DIMENSION / longest;
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);

    // Type preserved, not normalised: a PNG re-encoded as JPEG loses its alpha.
    const blob = await canvas.convertToBlob({ type: file.type, quality: 0.92 });
    if (blob.type !== file.type || blob.size >= file.size) return file;
    return new File([blob], file.name, { type: file.type });
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}

// Pasted screenshots are all called "image.png". The stamp is only accurate to
// the second, so the counter is what actually keeps them apart.
let lastStamp = "";
let sequence = 0;

export function nameForPastedFile(file: File): string {
  const stamp = new Date().toTimeString().slice(0, 8).replaceAll(":", "");
  if (stamp === lastStamp) {
    sequence += 1;
  } else {
    lastStamp = stamp;
    sequence = 0;
  }
  const extension = file.type.split("/")[1]?.replace(/[^a-z0-9]/g, "") || "png";
  return `pasted-${stamp}${sequence > 0 ? `-${sequence + 1}` : ""}.${extension}`;
}
