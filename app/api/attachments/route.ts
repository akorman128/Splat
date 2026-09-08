import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";
import { extractAttachment } from "@/lib/attachments/extract";
import {
  ATTACHMENTS_BUCKET,
  CARD_ATTACHMENT_COLUMNS,
  MAX_INLINE_BYTES,
  SIZE_CAPS,
  formatBytes,
  sentAsPages,
  sizeCapMessage,
  type AttachmentKind,
} from "@/lib/attachments/types";

export const maxDuration = 60;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Records a file the browser has already put in the bucket against the row
// /upload-url wrote when it signed the URL. The bytes are read back out rather
// than taken from the request, so what gets measured and extracted is what was
// actually stored.
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const supabase = await createClient();

  let body: { id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const id =
    typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
  if (!id) {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }

  const { data: draft } = await supabase
    .from("attachments")
    .select(`${CARD_ATTACHMENT_COLUMNS}, storage_path`)
    .eq("id", id)
    .maybeSingle();
  if (!draft) {
    return NextResponse.json(
      { error: "That upload was never started — attach the file again." },
      { status: 404 },
    );
  }
  // A retried record finds the work already done, and answers with it.
  const { storage_path: path, ...recorded } = draft;
  if (draft.extract_status !== "pending") {
    return NextResponse.json({ attachment: recorded });
  }
  const kind = draft.kind as AttachmentKind;

  // Object first: the row is the only place the path is written down.
  const discard = async (error: string, status: number) => {
    await supabase.storage.from(ATTACHMENTS_BUCKET).remove([path]);
    await supabase.from("attachments").delete().eq("id", id);
    return NextResponse.json({ error }, { status });
  };

  const { data: stored, error: downloadError } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .download(path);
  // Left as it is: a put still landing can be recorded on a retry, and one
  // that never lands is a draft the sweep reclaims.
  if (downloadError || !stored) {
    return NextResponse.json(
      { error: "That upload did not finish — attach the file again." },
      { status: 404 },
    );
  }

  // The signed URL authorises anything up to the bucket's own limit, which is
  // well over the caps for most kinds.
  if (stored.size === 0) {
    return await discard("That file is empty.", 400);
  }
  const cap = SIZE_CAPS[kind];
  if (stored.size > cap) {
    return await discard(
      `${draft.filename} is ${sizeCapMessage(stored.size, cap)}`,
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
        `${draft.filename} is a ${formatBytes(bytes.byteLength)} PDF with no text to extract, so it has to be sent as pages — and the limit for that is ${formatBytes(MAX_INLINE_BYTES)}.`,
        413,
      );
    }

    const { data: row, error: updateError } = await supabase
      .from("attachments")
      .update({
        byte_size: bytes.byteLength,
        image_width: extracted.width,
        image_height: extracted.height,
        extract_status: extracted.status,
        extract_error: extracted.error,
        extracted_text: extracted.text,
        truncated: extracted.truncated,
        est_tokens: extracted.estTokens,
      })
      .eq("id", id)
      .select(CARD_ATTACHMENT_COLUMNS)
      .maybeSingle();
    if (updateError || !row) {
      throw new Error(updateError?.message ?? "Could not record the file");
    }
    return NextResponse.json({ attachment: row });
  } catch (err) {
    return await discard(
      err instanceof Error ? err.message : "Could not process the file",
      500,
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
