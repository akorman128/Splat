import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";
import { extractAttachment } from "@/lib/attachments/extract";
import {
  ATTACHMENTS_BUCKET,
  CARD_ATTACHMENT_COLUMNS,
  MAX_FILENAME_LENGTH,
  SIZE_CAPS,
  sizeCapMessage,
  storagePath,
} from "@/lib/attachments/types";
import { asTranscript, transcriptDocument } from "@/lib/meetings/transcript";

const SUFFIX = " transcript.md";

// Writes the transcript as a draft, the same row an upload would leave, so the
// composer, the send and the sweep all treat it as any other attached file.
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/meetings/[meetingId]/attachment">,
) {
  const { meetingId } = await ctx.params;
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const supabase = await createClient();

  let body: { conversationId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const conversationId =
    typeof body.conversationId === "string" ? body.conversationId : null;
  if (!conversationId) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const [{ data: conversation }, { data: meeting }] = await Promise.all([
    supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .maybeSingle(),
    supabase
      .from("meetings")
      .select("title, met_at, transcript")
      .eq("id", meetingId)
      .maybeSingle(),
  ]);
  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 },
    );
  }
  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  const bytes = new TextEncoder().encode(
    transcriptDocument(
      meeting.title,
      meeting.met_at,
      asTranscript(meeting.transcript),
    ),
  );
  const filename = `${meeting.title
    .replace(/[\\/]/g, "-")
    .slice(0, MAX_FILENAME_LENGTH - SUFFIX.length)}${SUFFIX}`;
  if (bytes.byteLength > SIZE_CAPS.text) {
    return NextResponse.json(
      {
        error: `The transcript is ${sizeCapMessage(bytes.byteLength, SIZE_CAPS.text)}`,
      },
      { status: 413 },
    );
  }

  const id = randomUUID();
  const path = storagePath(user.id, conversationId, id, filename);
  const { error: uploadError } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(path, bytes, { contentType: "text/plain" });
  if (uploadError) {
    return NextResponse.json(
      { error: `Could not store the transcript: ${uploadError.message}` },
      { status: 500 },
    );
  }

  const extracted = await extractAttachment(bytes, "text");
  const { data: attachment, error: insertError } = await supabase
    .from("attachments")
    .insert({
      id,
      user_id: user.id,
      conversation_id: conversationId,
      node_id: null,
      storage_path: path,
      filename,
      mime_type: "text/plain",
      byte_size: bytes.byteLength,
      kind: "text",
      extract_status: extracted.status,
      extract_error: extracted.error,
      extracted_text: extracted.text,
      truncated: extracted.truncated,
      est_tokens: extracted.estTokens,
    })
    .select(CARD_ATTACHMENT_COLUMNS)
    .single();
  if (insertError || !attachment) {
    await supabase.storage.from(ATTACHMENTS_BUCKET).remove([path]);
    return NextResponse.json(
      {
        error: `Could not attach the transcript: ${insertError?.message ?? "unknown"}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ attachment });
}
