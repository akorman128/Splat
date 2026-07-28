import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractAttachment } from "@/lib/attachments/extract";
import {
  ATTACHMENTS_BUCKET,
  CARD_ATTACHMENT_COLUMNS,
  SIZE_CAPS,
  classify,
  formatBytes,
  storageExtension,
} from "@/lib/attachments/types";

// Parsing a 200-page PDF is the slow part, not the transfer.
export const maxDuration = 60;

const MAX_FILENAME_LENGTH = 200;

// The bytes come through this route rather than a signed direct-to-storage URL
// because the server needs them anyway: a file has no token estimate until its
// text has been extracted, and extraction cannot happen in the browser. Going
// direct would mean uploading, then downloading the same bytes back to parse.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }

  const conversationId = form.get("conversationId");
  const file = form.get("file");
  if (typeof conversationId !== "string" || !(file instanceof File)) {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 },
    );
  }

  // Classified before truncation: a name long enough to be cut loses its
  // extension, and a .ts file with no extension left falls back to the MIME the
  // browser reported — video/mp2t — and is rejected as video.
  const untruncated = file.name.split(/[\\/]/).pop() || "attachment";
  const classification = classify(untruncated, file.type);
  const filename = untruncated.slice(0, MAX_FILENAME_LENGTH);
  if (!classification.ok) {
    return NextResponse.json(
      { error: classification.message },
      { status: 415 },
    );
  }
  const { kind, mimeType } = classification;

  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  }
  const cap = SIZE_CAPS[kind];
  if (file.size > cap) {
    return NextResponse.json(
      {
        error: `${filename} is ${formatBytes(file.size)} — the limit for this kind of file is ${formatBytes(cap)}.`,
      },
      { status: 413 },
    );
  }

  const id = randomUUID();
  const path = `${user.id}/${conversationId}/${id}${storageExtension(untruncated)}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(path, bytes, { contentType: mimeType, upsert: false });
  if (uploadError) {
    return NextResponse.json(
      { error: `Could not store the file: ${uploadError.message}` },
      { status: 500 },
    );
  }

  // Past this line the object exists, so every failure has to take it back out
  // — an object with no row is invisible to the app and never reclaimed.
  try {
    const extracted = await extractAttachment(bytes, kind);
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
        byte_size: file.size,
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

// Only a draft can be taken back. Once a card has sent a file, that file is
// part of what the card is: node_attachments records the send, and no snapshot
// of the payload exists to fall back on.
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

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
