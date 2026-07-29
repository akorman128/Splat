"use client";

import { apiFetch, postJson } from "@/lib/query/api";
import { createClient } from "@/lib/supabase/client";
import { ATTACHMENTS_BUCKET } from "@/lib/attachments/types";
import type { CardAttachment } from "@/lib/types";

// Every provider downscales past this, so sending more is bytes and tokens
// spent on pixels nobody will look at.
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

// XMLHttpRequest, not fetch. A fetch request body can only report upload
// progress through `duplex: "half"` streaming, which is Chromium-over-HTTP/2
// only — and a file upload with no progress bar reads as a hang. This is the
// one place in the app that talks to the network without postJson.
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
  const promise = new Promise<CardAttachment>((resolve, reject) => {
    const form = new FormData();
    form.append("conversationId", conversationId);
    form.append("file", file, file.name);

    xhr.open("POST", "/api/attachments");
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener("load", () => {
      let body: { attachment?: CardAttachment; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText) as typeof body;
      } catch {
        body = {};
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.attachment) {
        resolve(body.attachment);
        return;
      }
      reject(new Error(body.error ?? `Upload failed (${xhr.status})`));
    });
    xhr.addEventListener("error", () =>
      reject(new Error("Network error — the upload never reached the server.")),
    );
    xhr.addEventListener("abort", () => reject(new UploadAbortedError()));
    xhr.send(form);
  });

  return { promise, abort: () => xhr.abort() };
}

export async function deleteAttachment(id: string): Promise<void> {
  await apiFetch(`/api/attachments?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// Where a card's — or a conversation's — objects live, read before the rows go.
// The row is the only record of the path and the delete cascades it away, so
// this has to run first; removing the objects does not, and must not, because
// a delete that then fails would leave a card whose pills point at files that
// are no longer there. Paths first, delete, then removeAttachmentObjects.
//
// Paged for the same reason the sweep is: PostgREST caps a select at
// db-max-rows, and the rows past the cap are objects nobody will ever have the
// path to again.
export async function attachmentObjectPaths(
  scope: { nodeIds: string[] } | { conversationId: string },
): Promise<string[]> {
  const supabase = createClient();
  const PAGE = 1000;
  const paths: string[] = [];
  for (let from = 0; ; ) {
    const query = supabase
      .from("attachments")
      .select("storage_path")
      .order("storage_path")
      .range(from, from + PAGE - 1);
    const { data, error } =
      "nodeIds" in scope
        ? await query.in("node_id", scope.nodeIds)
        : await query.eq("conversation_id", scope.conversationId);
    if (error) {
      console.warn(
        "Could not list attachment objects to remove:",
        error.message,
      );
      return paths;
    }
    if (!data || data.length === 0) break;
    paths.push(...data.map((row) => row.storage_path));
    from += data.length;
  }
  return paths;
}

// A failure here is logged rather than thrown — losing a delete because storage
// hiccuped would be worse than the leak. This is the fast path, not the
// guarantee: /api/attachments/sweep reclaims a whole conversation folder that
// has no rows left, which is exactly what a delete that got this far and no
// further looks like.
export async function removeAttachmentObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await createClient()
    .storage.from(ATTACHMENTS_BUCKET)
    .remove(paths);
  if (error) {
    console.warn("Could not remove attachment objects:", error.message);
  }
}

// Once per conversation per page load, and never awaited: reclaiming leftovers
// is housekeeping, and nothing on screen should wait for it or hear about it.
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

// Re-encoding a GIF drops every frame after the first, and an animation the
// user chose to attach is worth more than the bytes it saves. Exported because
// the size cap has to know whether a file is one we can still shrink.
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

    // The type is preserved rather than normalised: a PNG re-encoded as JPEG
    // loses its alpha channel, and screenshots of UI are mostly what gets
    // pasted here.
    const blob = await canvas.convertToBlob({ type: file.type, quality: 0.92 });
    if (blob.type !== file.type || blob.size >= file.size) return file;
    return new File([blob], file.name, { type: file.type });
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}

// Three screenshots pasted in a row are three files called "image.png"; the
// chips would be indistinguishable. The clock makes them tell each other apart
// — but only to the second, and two pastes a moment apart are two separate
// calls, so the counter carries across them and the stamp alone never has to
// be unique.
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
