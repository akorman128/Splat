import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

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

  // Objects with no row: a claim that failed and rolled back, or an insert that
  // errored after the upload. Scoped to one conversation's folder because that
  // is one list call, and it is the folder the caller is looking at anyway.
  if (conversationId) {
    const prefix = `${user.id}/${conversationId}`;
    const [{ data: objects }, { data: rows }] = await Promise.all([
      supabase.storage.from(ATTACHMENTS_BUCKET).list(prefix, { limit: 1000 }),
      supabase
        .from("attachments")
        .select("storage_path")
        .eq("conversation_id", conversationId),
    ]);
    const known = new Set((rows ?? []).map((row) => row.storage_path));
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
      orphans = stale.length;
    }
  }

  return NextResponse.json({ drafts, orphans });
}
