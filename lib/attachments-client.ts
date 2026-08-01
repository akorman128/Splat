"use client";

import { apiFetch, postJson } from "@/lib/query/api";
import { createClient } from "@/lib/supabase/client";
import { selectAllPages } from "@/lib/supabase/pagination";
import { ATTACHMENTS_BUCKET } from "@/lib/attachments/types";
import type { CardAttachment } from "@/lib/types";

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

// XMLHttpRequest, not fetch: a fetch body can only report upload progress
// through `duplex: "half"` streaming, which is Chromium-over-HTTP/2 only.
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

export async function createConversation(): Promise<string> {
  const { id } = await apiFetch<{ id: string }>(
    "/api/conversations",
    postJson({}),
  );
  return id;
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
