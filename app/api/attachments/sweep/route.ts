import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";
import { ATTACHMENTS_BUCKET } from "@/lib/attachments/types";

// Reclaims what the happy path cannot: composers abandoned before send, and
// objects whose row went away underneath them.
//
// This runs as the signed-in user, not as a cron job, and that is deliberate.
// A cron request carries no session, so it could only work through a
// service-role client — and the whole security story of this app is that RLS
// scopes everything to auth.uid() and no such client exists (see the README).
// Every user reclaims their own leftovers the next time they open a
// conversation, which costs one request and needs no elevated key anywhere.
export const maxDuration = 30;

// Long enough that a slow upload on a bad connection is never mistaken for
// abandonment.
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const supabase = await createClient();

  let conversationId: string | null = null;
  try {
    const body = (await request.json()) as { conversationId?: unknown };
    if (typeof body.conversationId === "string") {
      conversationId = body.conversationId;
    }
  } catch {
    conversationId = null;
  }

  const now = Date.now();
  let drafts = 0;
  let orphans = 0;

  const { data: abandoned } = await supabase
    .from("attachments")
    .select("id, storage_path")
    .is("node_id", null)
    .lt("created_at", new Date(now - DRAFT_TTL_MS).toISOString());
  if (abandoned && abandoned.length > 0) {
    await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .remove(abandoned.map((row) => row.storage_path));
    await supabase
      .from("attachments")
      .delete()
      .in(
        "id",
        abandoned.map((row) => row.id),
      );
    drafts = abandoned.length;
  }

  // Objects with no row: a claim that failed and rolled back, an insert that
  // errored after the upload, or — the one that actually loses money — a
  // conversation deleted before its objects were removed. That last case is
  // unrecoverable from the rows, because the cascade takes every storage_path
  // with the conversation, so the listing has to be the source of truth here
  // rather than the table.
  //
  // Every folder under the user's prefix is one conversation. A folder with no
  // surviving rows belongs to a conversation that no longer exists, and
  // everything in it is reclaimable. The common case — no deleted
  // conversations — costs one list call and one select.
  const { data: folders } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .list(user.id, { limit: 1000 });
  const { data: rows } = await supabase
    .from("attachments")
    .select("storage_path, conversation_id");

  const known = new Set((rows ?? []).map((row) => row.storage_path));
  const liveConversations = new Set(
    (rows ?? []).map((row) => row.conversation_id),
  );

  // Supabase reports a pseudo-directory as an entry with a null id.
  const conversationFolders = (folders ?? [])
    .filter((entry) => entry.id === null)
    .map((entry) => entry.name);
  // The folder on screen is swept even when it holds no rows yet, so a failed
  // first upload is reclaimed rather than waiting for the conversation to be
  // deleted.
  const sweepable = conversationFolders.filter(
    (name) => !liveConversations.has(name) || name === conversationId,
  );

  for (const folder of sweepable) {
    const prefix = `${user.id}/${folder}`;
    const { data: objects } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .list(prefix, { limit: 1000 });
    const stale = (objects ?? [])
      .filter((object) => {
        // An upload in flight has no row yet; only objects old enough to have
        // finished either way are candidates.
        const createdAt = object.created_at
          ? Date.parse(object.created_at)
          : now;
        return (
          now - createdAt > ORPHAN_MIN_AGE_MS &&
          !known.has(`${prefix}/${object.name}`)
        );
      })
      .map((object) => `${prefix}/${object.name}`);
    if (stale.length > 0) {
      await supabase.storage.from(ATTACHMENTS_BUCKET).remove(stale);
      orphans += stale.length;
    }
  }

  return NextResponse.json({ drafts, orphans });
}
