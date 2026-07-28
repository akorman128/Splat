import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { ChatMessage, ContentPart } from "@/lib/providers/types";
import {
  ATTACHMENTS_BUCKET,
  MAX_IMAGES_PER_REQUEST,
  MAX_INLINE_IMAGE_BYTES,
  formatBytes,
  isImageMimeType,
} from "./types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// What a turn needs to know about a file to send it. Read straight off
// `attachments`, extracted_text and all — this is the one place that text is
// allowed to travel.
export type TurnAttachment = {
  id: string;
  node_id: string | null;
  conversation_id: string;
  filename: string;
  mime_type: string;
  kind: string;
  storage_path: string;
  extracted_text: string | null;
  extract_status: string;
  truncated: boolean;
};

export const TURN_ATTACHMENT_COLUMNS =
  "id, node_id, conversation_id, filename, mime_type, kind, storage_path, extracted_text, extract_status, truncated";

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Delimited so the model can tell where a 400,000-character spreadsheet stops
// and the question starts.
function describe(attachment: TurnAttachment): string {
  const attributes = `name="${escapeAttribute(attachment.filename)}" type="${attachment.mime_type}"`;
  if (attachment.extract_status === "ok" && attachment.extracted_text) {
    return `<attachment ${attributes}${attachment.truncated ? ' truncated="true"' : ""}>\n${attachment.extracted_text}\n</attachment>`;
  }
  const note =
    attachment.extract_status === "empty"
      ? "no text could be extracted — it is probably a scan"
      : "this file could not be read";
  return `<attachment ${attributes} note="${note}" />`;
}

// Files first, question last. A model that reads the question first spends the
// document looking for the answer instead of reading it.
function contentFor(
  prompt: string,
  attachments: TurnAttachment[],
  images: Map<string, ContentPart>,
): string | ContentPart[] {
  if (attachments.length === 0) return prompt;

  const parts: ContentPart[] = [];
  for (const attachment of attachments) {
    const image = images.get(attachment.id);
    if (image) {
      parts.push({
        type: "text",
        text: `<attachment name="${escapeAttribute(attachment.filename)}" type="${attachment.mime_type}" />`,
      });
      parts.push(image);
      continue;
    }
    parts.push({ type: "text", text: describe(attachment) });
  }
  parts.push({ type: "text", text: prompt });
  return parts;
}

// Which message a file rides on. Everything here is driven by *this* turn's
// selection — never by a context card's historical set, which would re-inject
// the file on every follow-up down the branch, the exact cost this feature
// exists to avoid. But a file that is being replayed while its own card is in
// context goes back where it came from, so the conversation reads the way it
// originally happened: here is the file, here is my question about it.
export function assembleMessages({
  contextIds,
  nodesById,
  node,
  attachments,
  images,
}: {
  contextIds: string[];
  nodesById: Map<string, { id: string; prompt: string; response: string }>;
  node: { id: string; prompt: string };
  attachments: TurnAttachment[];
  images: Map<string, ContentPart>;
}): ChatMessage[] {
  const inContext = new Set(contextIds);
  const placed = new Map<string, TurnAttachment[]>();
  for (const attachment of attachments) {
    const owner = attachment.node_id;
    const key =
      owner && owner !== node.id && inContext.has(owner) ? owner : node.id;
    const list = placed.get(key);
    if (list) list.push(attachment);
    else placed.set(key, [attachment]);
  }

  const messages: ChatMessage[] = [];
  for (const id of contextIds) {
    const contextNode = nodesById.get(id);
    if (!contextNode) continue;
    messages.push({
      role: "user",
      content: contentFor(contextNode.prompt, placed.get(id) ?? [], images),
    });
    if (contextNode.response) {
      messages.push({ role: "assistant", content: contextNode.response });
    }
  }
  messages.push({
    role: "user",
    content: contentFor(node.prompt, placed.get(node.id) ?? [], images),
  });
  return messages;
}

export type ImageLoad =
  | { ok: true; images: Map<string, ContentPart> }
  | { ok: false; status: number; error: string };

// Downloaded before the response stream is constructed, so a storage failure
// is a clean JSON 5xx rather than a stream that opens and then dies.
export async function loadImageParts(
  supabase: SupabaseServerClient,
  attachments: TurnAttachment[],
): Promise<ImageLoad> {
  const images = attachments.filter((a) => a.kind === "image");
  if (images.length === 0) return { ok: true, images: new Map() };
  if (images.length > MAX_IMAGES_PER_REQUEST) {
    return {
      ok: false,
      status: 413,
      error: `A single prompt can carry at most ${MAX_IMAGES_PER_REQUEST} images.`,
    };
  }

  const parts = new Map<string, ContentPart>();
  let total = 0;
  for (const image of images) {
    if (!isImageMimeType(image.mime_type)) continue;
    const { data, error } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .download(image.storage_path);
    if (error || !data) {
      return {
        ok: false,
        status: 502,
        error: `Could not read ${image.filename} back from storage.`,
      };
    }
    const bytes = Buffer.from(await data.arrayBuffer());
    total += bytes.byteLength;
    if (total > MAX_INLINE_IMAGE_BYTES) {
      return {
        ok: false,
        status: 413,
        error: `Those images come to more than ${formatBytes(MAX_INLINE_IMAGE_BYTES)} together — send fewer at once.`,
      };
    }
    parts.set(image.id, {
      type: "image",
      mediaType: image.mime_type,
      data: bytes.toString("base64"),
    });
  }
  return { ok: true, images: parts };
}
