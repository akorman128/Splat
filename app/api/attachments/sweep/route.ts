import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";
import { selectAllPages } from "@/lib/supabase/pagination";
import { ATTACHMENTS_BUCKET } from "@/lib/attachments/types";

// Runs as the signed-in user rather than as a cron job: a cron request carries
// no session, so it would need a service-role client, and this app has none.
export const maxDuration = 30;

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

  // One folder per conversation. A deleted conversation takes every
  // storage_path with it, so the listing — not the table — is what finds them.
  const { data: folders } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .list(user.id, { limit: 1000 });

  // Every row, paged, before anything is deleted: a conversation missing from
  // the answer looks deleted, and its live files get swept.
  const { rows, error: rowsError } = await selectAllPages((from, to) =>
    supabase
      .from("attachments")
      .select("storage_path, conversation_id")
      .order("storage_path")
      .range(from, to),
  );
  // A failed read is indistinguishable from an empty table, and one of those
  // two answers deletes everything the user owns.
  if (rowsError) {
    return NextResponse.json(
      { error: "Could not read the attachment list." },
      { status: 500 },
    );
  }

  const known = new Set(rows.map((row) => row.storage_path));
  const liveConversations = new Set(rows.map((row) => row.conversation_id));

  // Supabase reports a pseudo-directory as an entry with a null id.
  const conversationFolders = (folders ?? [])
    .filter((entry) => entry.id === null)
    .map((entry) => entry.name);
  // The folder on screen is swept even when it holds no rows yet, so a failed
  // first upload does not wait for the conversation to be deleted.
  const sweepable = conversationFolders.filter(
    (name) => !liveConversations.has(name) || name === conversationId,
  );

  const listings = await Promise.all(
    sweepable.map(async (folder) => {
      const prefix = `${user.id}/${folder}`;
      const { data: objects } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .list(prefix, { limit: 1000 });
      return (objects ?? [])
        .filter((object) => {
          // An upload in flight has no row yet.
          const createdAt = object.created_at
            ? Date.parse(object.created_at)
            : now;
          return (
            now - createdAt > ORPHAN_MIN_AGE_MS &&
            !known.has(`${prefix}/${object.name}`)
          );
        })
        .map((object) => `${prefix}/${object.name}`);
    }),
  );

  const stale = listings.flat();
  if (stale.length > 0) {
    await supabase.storage.from(ATTACHMENTS_BUCKET).remove(stale);
    orphans = stale.length;
  }

  return NextResponse.json({ drafts, orphans });
}
