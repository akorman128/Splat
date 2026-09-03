import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { NodeRow } from "@/lib/types";
import { INTERRUPTED_MESSAGE, STALE_STREAM_MS } from "./stale";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// The cutoff is re-evaluated at write time, so a caller that has already decided
// which rows are stale passes them in: without that, a row that crosses the
// threshold between the read and this write is cleared in the database while the
// caller still renders it as streaming, and nothing corrects it until a hard
// reload. A run that came back to life in that window holds a fresh updated_at
// and keeps its card either way.
export async function reclaimStaleStreams(
  supabase: SupabaseServerClient,
  conversationId: string,
  nodeIds?: string[],
): Promise<NodeRow[]> {
  if (nodeIds?.length === 0) return [];
  let query = supabase
    .from("nodes")
    .update({
      status: "error",
      error_message: INTERRUPTED_MESSAGE,
      // Breaks the fence too: whatever run held this card cannot write to it
      // again, even if it is somehow still alive.
      stream_token: null,
      cancel_requested: false,
    })
    .eq("conversation_id", conversationId)
    .eq("status", "streaming")
    .lt("updated_at", new Date(Date.now() - STALE_STREAM_MS).toISOString());
  if (nodeIds) query = query.in("id", nodeIds);
  const { data } = await query.select();
  return data ?? [];
}
