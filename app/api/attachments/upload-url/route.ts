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

// Signs an upload the browser performs itself. The bytes never pass through a
// function, which is what the old multipart POST did — and what the host
// rejected with a bare 413 once a file cleared its request body limit.
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

  const id = randomUUID();
  const path = storagePath(user.id, conversationId, id, untruncated);
  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
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
