import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";
import {
  ATTACHMENTS_BUCKET,
  MAX_FILENAME_LENGTH,
  SIZE_CAPS,
  classify,
  sizeCapMessage,
  storagePath,
} from "@/lib/attachments/types";

// The bytes go from the browser to storage without passing through a function,
// which is what capped an upload at the host's request body limit.
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const supabase = await createClient();

  let body: {
    conversationId?: unknown;
    filename?: unknown;
    mimeType?: unknown;
    size?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const conversationId =
    typeof body.conversationId === "string" ? body.conversationId : null;
  const untruncated =
    typeof body.filename === "string"
      ? body.filename.split(/[\\/]/).pop() || ""
      : "";
  const reported = typeof body.mimeType === "string" ? body.mimeType : "";
  const size = typeof body.size === "number" ? body.size : Number.NaN;
  if (!conversationId || !untruncated || !Number.isInteger(size) || size < 0) {
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

  // Classified before truncation: a cut name loses its extension, and falls
  // back to the MIME the browser reported.
  const classification = classify(untruncated, reported);
  const filename = untruncated.slice(0, MAX_FILENAME_LENGTH);
  if (!classification.ok) {
    return NextResponse.json(
      { error: classification.message },
      { status: 415 },
    );
  }

  if (size === 0) {
    return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  }
  // The size the browser claims, so this is only the early answer. What the
  // bucket accepts and what finalise measures are the ones that bind.
  const cap = SIZE_CAPS[classification.kind];
  if (size > cap) {
    return NextResponse.json(
      { error: `${filename} is ${sizeCapMessage(size, cap)}` },
      { status: 413 },
    );
  }

  // The row is written before the URL is signed, so an upload that stops at
  // any later step — the put, the record, a closed tab — is a draft the sweep
  // and the DELETE handler already know how to take back. Finalise fills in
  // what only the stored bytes can say.
  const id = randomUUID();
  const path = storagePath(user.id, conversationId, id, untruncated);
  const { error: insertError } = await supabase.from("attachments").insert({
    id,
    user_id: user.id,
    conversation_id: conversationId,
    node_id: null,
    storage_path: path,
    filename,
    mime_type: classification.mimeType,
    byte_size: size,
    kind: classification.kind,
    extract_status: "pending",
  });
  if (insertError) {
    return NextResponse.json(
      { error: `Could not start the upload: ${insertError.message}` },
      { status: 500 },
    );
  }

  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    await supabase.from("attachments").delete().eq("id", id);
    return NextResponse.json(
      { error: `Could not start the upload: ${error?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  // The classified type, not the reported one: the bucket's allowed_mime_types
  // is the canonical list, and a .md arrives as application/octet-stream.
  return NextResponse.json({
    id,
    signedUrl: data.signedUrl,
    mimeType: classification.mimeType,
  });
}
