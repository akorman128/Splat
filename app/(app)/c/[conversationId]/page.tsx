import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GraphHydrator } from "@/components/canvas/GraphHydrator";
import { StreamWatcher } from "@/components/canvas/StreamWatcher";
import { CARD_ATTACHMENT_COLUMNS } from "@/lib/attachments/types";
import { INTERRUPTED_MESSAGE, isStaleStream } from "@/lib/streams/stale";
import { reclaimStaleStreams } from "@/lib/streams/reclaim";
import type { CardAttachment } from "@/lib/types";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const supabase = await createClient();

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) notFound();

  const { data: rows } = await supabase
    .from("nodes")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at");

  // Decided from the rows already in hand, so an ordinary load costs nothing:
  // a card orphaned by a run that died — the tab closed before the client could
  // say so — is cleared here instead of spinning forever.
  const stale = new Set((rows ?? []).filter(isStaleStream).map((n) => n.id));
  if (stale.size > 0) {
    await reclaimStaleStreams(supabase, conversationId, [...stale]);
  }
  const nodes = (rows ?? []).map((node) =>
    stale.has(node.id)
      ? { ...node, status: "error", error_message: INTERRUPTED_MESSAGE }
      : node,
  );

  const nodeIds = nodes.map((n) => n.id);
  const [{ data: edges }, { data: suggestions }, { data: attachments }] =
    nodeIds.length
      ? await Promise.all([
          supabase.from("context_edges").select("*").in("node_id", nodeIds),
          supabase.from("suggestions").select("*").in("node_id", nodeIds),
          supabase
            .from("attachments")
            .select(CARD_ATTACHMENT_COLUMNS)
            .in("node_id", nodeIds)
            .order("created_at"),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];

  return (
    <>
      <GraphHydrator
        conversationId={conversationId}
        nodes={nodes}
        edges={edges ?? []}
        suggestions={suggestions ?? []}
        attachments={(attachments ?? []) as CardAttachment[]}
      />
      <StreamWatcher conversationId={conversationId} />
    </>
  );
}
