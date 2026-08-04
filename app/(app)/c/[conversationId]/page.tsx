import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GraphHydrator } from "@/components/canvas/GraphHydrator";
import { CARD_ATTACHMENT_COLUMNS } from "@/lib/attachments/types";
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

  const { data: nodes } = await supabase
    .from("nodes")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at");

  const nodeIds = (nodes ?? []).map((n) => n.id);
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
    <GraphHydrator
      conversationId={conversationId}
      nodes={nodes ?? []}
      edges={edges ?? []}
      suggestions={suggestions ?? []}
      attachments={(attachments ?? []) as CardAttachment[]}
    />
  );
}
