import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";
import { extractAttachment } from "@/lib/attachments/extract";
import {
  ATTACHMENTS_BUCKET,
  CARD_ATTACHMENT_COLUMNS,
  MAX_FILENAME_LENGTH,
  MAX_INLINE_BYTES,
  SIZE_CAPS,
  classify,
  formatBytes,
  sentAsPages,
  sizeCapMessage,
  storagePath,
} from "@/lib/attachments/types";

export const maxDuration = 60;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Records a file the browser has already put in the bucket against a URL
// /upload-url signed. The bytes are read back out rather than taken from the
// request: what gets measured and extracted is then what was actually stored,
// and the id is the only part of the path a caller supplies.
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const supabase = await createClient();

  let body: {
    conversationId?: unknown;
    id?: unknown;
    filename?: unknown;
    mimeType?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const conversationId =
    typeof body.conversationId === "string" ? body.conversationId : null;
  const id =
    typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
  const untruncated =
    typeof body.filename === "string"
      ? body.filename.split(/[\\/]/).pop() || ""
      : "";
  const reported = typeof body.mimeType === "string" ? body.mimeType : "";
  if (!conversationId || !id || !untruncated) {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }

  // The bytes are already in the bucket by the time this runs — the browser put
  // them there — so every failure from here has to take them back out.
  const path = storagePath(user.id, conversationId, id, untruncated);
  const discard = async (error: string, status: number) => {
    await supabase.storage.from(ATTACHMENTS_BUCKET).remove([path]);
    return NextResponse.json({ error }, { status });
  };

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) {
    return await discard("Conversation not found", 404);
  }

  // Classified before truncation: a cut name loses its extension, and falls
  // back to the MIME the browser reported.
  const classification = classify(untruncated, reported);
  const filename = untruncated.slice(0, MAX_FILENAME_LENGTH);
  if (!classification.ok) {
    return await discard(classification.message, 415);
  }
  const { kind, mimeType } = classification;

  const { data: stored, error: downloadError } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .download(path);
  if (downloadError || !stored) {
    return NextResponse.json(
      { error: "That upload did not finish — attach the file again." },
      { status: 404 },
    );
  }

  // Measured off the blob before it is copied into a buffer: the signed URL
  // authorises anything up to the bucket's own limit, which is well over the
  // caps for most kinds.
  if (stored.size === 0) {
    return await discard("That file is empty.", 400);
  }
  const cap = SIZE_CAPS[kind];
  if (stored.size > cap) {
    return await discard(
      `${filename} is ${sizeCapMessage(stored.size, cap)}`,
      413,
    );
  }

  const bytes = new Uint8Array(await stored.arrayBuffer());

  try {
    const extracted = await extractAttachment(bytes, kind);

    // Caught here rather than at send: a PDF with no text to extract travels as
    // its own bytes, so one too large to fit a request is a file the composer
    // would take and then refuse to send for as long as it sat there.
    if (
      sentAsPages({ kind, extract_status: extracted.status }) &&
      bytes.byteLength > MAX_INLINE_BYTES
    ) {
      return await discard(
        `${filename} is a ${formatBytes(bytes.byteLength)} PDF with no text to extract, so it has to be sent as pages — and the limit for that is ${formatBytes(MAX_INLINE_BYTES)}.`,
        413,
      );
    }

    const { data: row, error: insertError } = await supabase
      .from("attachments")
      .insert({
        id,
        user_id: user.id,
        conversation_id: conversationId,
        node_id: null,
        storage_path: path,
        filename,
        mime_type: mimeType,
        byte_size: bytes.byteLength,
        kind,
        image_width: extracted.width,
        image_height: extracted.height,
        extract_status: extracted.status,
        extract_error: extracted.error,
        extracted_text: extracted.text,
        truncated: extracted.truncated,
        est_tokens: extracted.estTokens,
      })
      .select(CARD_ATTACHMENT_COLUMNS)
      .single();
    // A retried record finds its own row already there. The object belongs to
    // whichever call inserted first, so this one answers with that row rather
    // than reporting a failure for a file that is in fact attached — and, more
    // to the point, without reaching the cleanup below.
    if (insertError?.code === "23505") {
      const { data: existing } = await supabase
        .from("attachments")
        .select(CARD_ATTACHMENT_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (existing) return NextResponse.json({ attachment: existing });
      return NextResponse.json(
        { error: "That file is already attached." },
        { status: 409 },
      );
    }
    if (insertError || !row) {
      throw new Error(insertError?.message ?? "Could not record the file");
    }
    return NextResponse.json({ attachment: row });
  } catch (err) {
    await supabase.storage.from(ATTACHMENTS_BUCKET).remove([path]);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Could not process the file",
      },
      { status: 500 },
    );
  }
}

// Only a draft can be taken back; a sent file is part of what the card is.
export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const supabase = await createClient();

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { data: attachment } = await supabase
    .from("attachments")
    .select("id, node_id, storage_path")
    .eq("id", id)
    .maybeSingle();
  if (!attachment) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }
  if (attachment.node_id) {
    return NextResponse.json(
      { error: "A file that has already been sent can't be removed." },
      { status: 409 },
    );
  }

  // Object first: the row is the only place the path is written down.
  const { error: removeError } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .remove([attachment.storage_path]);
  if (removeError) {
    return NextResponse.json({ error: removeError.message }, { status: 500 });
  }
  const { error: deleteError } = await supabase
    .from("attachments")
    .delete()
    .eq("id", id);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
