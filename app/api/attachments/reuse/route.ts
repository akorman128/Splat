import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";
import {
  ATTACHMENTS_BUCKET,
  CARD_ATTACHMENT_COLUMNS,
  MAX_ATTACHMENTS_PER_TURN,
  storageExtension,
} from "@/lib/attachments/types";
import type { CardAttachment } from "@/lib/types";

// The bytes are copied inside the bucket rather than shared by path, because
// storage_path is unique and every delete site — the DELETE route, the card and
// conversation cascades, the sweep — removes the object the row names. Sharing
// one object between rows would make each of those a refcount.
const SOURCE_COLUMNS =
  "id, storage_path, filename, mime_type, byte_size, kind, image_width, image_height, extract_status, extract_error, extracted_text, truncated, est_tokens";

type SourceRow = {
  id: string;
  storage_path: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  kind: string;
  image_width: number | null;
  image_height: number | null;
  extract_status: string;
  extract_error: string | null;
  extracted_text: string | null;
  truncated: boolean;
  est_tokens: number;
};

export const maxDuration = 60;

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const supabase = await createClient();

  let body: { conversationId?: unknown; ids?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const conversationId =
    typeof body.conversationId === "string" ? body.conversationId : null;
  // Not deduplicated: the answer is positional, one row per id asked for.
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === "string")
    : [];
  if (!conversationId || ids.length === 0) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (ids.length > MAX_ATTACHMENTS_PER_TURN) {
    return NextResponse.json(
      {
        error: `A single prompt can carry at most ${MAX_ATTACHMENTS_PER_TURN} files.`,
      },
      { status: 400 },
    );
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

  const { data: sources, error: readError } = await supabase
    .from("attachments")
    .select(SOURCE_COLUMNS)
    .in("id", [...new Set(ids)]);
  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }
  const byId = new Map(
    ((sources ?? []) as unknown as SourceRow[]).map((row) => [row.id, row]),
  );
  if (ids.some((id) => !byId.has(id))) {
    return NextResponse.json(
      { error: "One of those files is no longer available." },
      { status: 404 },
    );
  }

  const copies = ids.map((id) => {
    const source = byId.get(id)!;
    const newId = randomUUID();
    return {
      id: newId,
      source,
      path: `${user.id}/${conversationId}/${newId}${storageExtension(source.filename)}`,
    };
  });

  const copied: string[] = [];
  try {
    const results = await Promise.all(
      copies.map((copy) =>
        supabase.storage
          .from(ATTACHMENTS_BUCKET)
          .copy(copy.source.storage_path, copy.path),
      ),
    );
    results.forEach((result, index) => {
      if (!result.error) copied.push(copies[index].path);
    });
    const failure = results.find((result) => result.error);
    if (failure?.error) {
      throw new Error(`Could not copy the file: ${failure.error.message}`);
    }

    // The extraction is copied with the row: the text, the token estimate and
    // the image dimensions were all settled at upload, and the bytes have not
    // changed, so there is nothing to re-derive.
    const { data: rows, error: insertError } = await supabase
      .from("attachments")
      .insert(
        copies.map((copy) => ({
          id: copy.id,
          user_id: user.id,
          conversation_id: conversationId,
          node_id: null,
          storage_path: copy.path,
          filename: copy.source.filename,
          mime_type: copy.source.mime_type,
          byte_size: copy.source.byte_size,
          kind: copy.source.kind,
          image_width: copy.source.image_width,
          image_height: copy.source.image_height,
          extract_status: copy.source.extract_status,
          extract_error: copy.source.extract_error,
          extracted_text: copy.source.extracted_text,
          truncated: copy.source.truncated,
          est_tokens: copy.source.est_tokens,
        })),
      )
      .select(CARD_ATTACHMENT_COLUMNS);
    const inserted = (rows ?? []) as unknown as CardAttachment[];
    if (insertError || inserted.length !== copies.length) {
      throw new Error(insertError?.message ?? "Could not record the files");
    }

    const byNewId = new Map(inserted.map((row) => [row.id, row]));
    return NextResponse.json({
      attachments: copies.map((copy) => byNewId.get(copy.id)!),
    });
  } catch (err) {
    if (copied.length > 0) {
      await supabase.storage.from(ATTACHMENTS_BUCKET).remove(copied);
    }
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Could not attach those files",
      },
      { status: 500 },
    );
  }
}
