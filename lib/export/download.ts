"use client";

export function filenameFor(title: string, extension: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${slug || "conversation"}.${extension}`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // The click starts the download synchronously, but Safari reads the blob a
  // touch later — revoking on the next frame would sometimes truncate it.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
