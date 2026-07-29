import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { ChatMessage, ContentPart } from "@/lib/providers/types";
import {
  ATTACHMENTS_BUCKET,
  MAX_IMAGES_PER_REQUEST,
  MAX_INLINE_BYTES,
  formatBytes,
  isImageMimeType,
  sentAsPages,
} from "./types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// The one shape that carries extracted_text; everything on the canvas uses
// CardAttachment instead.
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
  // The image's token cost is derived from these, and has to match the estimate
  // the composer showed before sending.
  image_width: number | null;
  image_height: number | null;
  // What a PDF sent whole costs, priced by the page at upload — there is nothing
  // to derive it from at send time.
  est_tokens: number;
};

export const TURN_ATTACHMENT_COLUMNS =
  "id, node_id, conversation_id, filename, mime_type, kind, storage_path, extracted_text, extract_status, truncated, image_width, image_height, est_tokens";

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function attributesOf(attachment: TurnAttachment): string {
  return `name="${escapeAttribute(attachment.filename)}" type="${attachment.mime_type}"`;
}

function describe(attachment: TurnAttachment): string {
  const attributes = attributesOf(attachment);
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
  inline: Map<string, ContentPart>,
): string | ContentPart[] {
  if (attachments.length === 0) return prompt;

  const parts: ContentPart[] = [];
  for (const attachment of attachments) {
    const part = inline.get(attachment.id);
    if (part) {
      parts.push({
        type: "text",
        text: `<attachment ${attributesOf(attachment)} />`,
      });
      parts.push(part);
      continue;
    }
    parts.push({ type: "text", text: describe(attachment) });
  }
  parts.push({ type: "text", text: prompt });
  return parts;
}

// Driven by this turn's selection, never by a context card's historical set —
// that would re-inject the file on every follow-up down the branch.
export function assembleMessages({
  contextIds,
  nodesById,
  node,
  attachments,
  inline,
}: {
  contextIds: string[];
  nodesById: Map<string, { id: string; prompt: string; response: string }>;
  node: { id: string; prompt: string };
  attachments: TurnAttachment[];
  inline: Map<string, ContentPart>;
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
      content: contentFor(contextNode.prompt, placed.get(id) ?? [], inline),
    });
    if (contextNode.response) {
      messages.push({ role: "assistant", content: contextNode.response });
    }
  }
  messages.push({
    role: "user",
    content: contentFor(node.prompt, placed.get(node.id) ?? [], inline),
  });
  return messages;
}

export type InlineLoad =
  | { ok: true; inline: Map<string, ContentPart> }
  | { ok: false; status: number; error: string };

// The files that travel as their own bytes rather than as extracted text.
function sentWhole(attachments: TurnAttachment[]): TurnAttachment[] {
  return attachments.filter(
    (a) =>
      (a.kind === "image" && isImageMimeType(a.mime_type)) || sentAsPages(a),
  );
}

// Downloaded before the response stream is constructed, so a storage failure
// is a clean JSON 5xx rather than a stream that opens and then dies.
export async function loadInlineParts(
  supabase: SupabaseServerClient,
  attachments: TurnAttachment[],
): Promise<InlineLoad> {
  const whole = sentWhole(attachments);
  if (whole.length === 0) return { ok: true, inline: new Map() };
  const images = whole.filter((a) => a.kind === "image").length;
  if (images > MAX_IMAGES_PER_REQUEST) {
    return {
      ok: false,
      status: 413,
      error: `A single prompt can carry at most ${MAX_IMAGES_PER_REQUEST} images.`,
    };
  }

  const parts = new Map<string, ContentPart>();
  let total = 0;
  for (const attachment of whole) {
    const { data, error } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .download(attachment.storage_path);
    if (error || !data) {
      return {
        ok: false,
        status: 502,
        error: `Could not read ${attachment.filename} back from storage.`,
      };
    }
    const bytes = Buffer.from(await data.arrayBuffer());
    total += bytes.byteLength;
    if (total > MAX_INLINE_BYTES) {
      return {
        ok: false,
        status: 413,
        error: `Those files come to more than ${formatBytes(MAX_INLINE_BYTES)} together — send fewer at once.`,
      };
    }
    // Re-narrowed rather than cast: sentWhole already checked the MIME, but the
    // filter cannot carry that down to here.
    if (isImageMimeType(attachment.mime_type)) {
      parts.set(attachment.id, {
        type: "image",
        mediaType: attachment.mime_type,
        data: bytes.toString("base64"),
        width: attachment.image_width,
        height: attachment.image_height,
      });
    } else {
      parts.set(attachment.id, {
        type: "document",
        data: bytes.toString("base64"),
        filename: attachment.filename,
        estTokens: attachment.est_tokens,
      });
    }
  }
  return { ok: true, inline: parts };
}
