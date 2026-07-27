"use client";

import { createClient } from "@/lib/supabase/client";
import type { NodeRow, ContextEdgeRow } from "@/lib/types";

export type ConversationExport = {
  conversation: {
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
  };
  nodes: NodeRow[];
  edges: ContextEdgeRow[];
};

// Reads from the database rather than the graph store, so a download works for
// any conversation in the sidebar, not just the one on screen.
export async function fetchConversation(
  conversationId: string,
): Promise<ConversationExport> {
  const supabase = createClient();

  const [conversation, nodes] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, title, created_at, updated_at")
      .eq("id", conversationId)
      .single(),
    supabase
      .from("nodes")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true }),
  ]);

  if (conversation.error) throw new Error(conversation.error.message);
  if (nodes.error) throw new Error(nodes.error.message);

  const rows = nodes.data ?? [];
  if (rows.length === 0) {
    return { conversation: conversation.data, nodes: rows, edges: [] };
  }

  const edges = await supabase
    .from("context_edges")
    .select("*, nodes!context_edges_node_id_fkey!inner(conversation_id)")
    .eq("nodes.conversation_id", conversationId)
    .order("position", { ascending: true });

  if (edges.error) throw new Error(edges.error.message);

  return {
    conversation: conversation.data,
    nodes: rows,
    edges: (edges.data ?? []).map((edge) => ({
      id: edge.id,
      node_id: edge.node_id,
      source_node_id: edge.source_node_id,
      position: edge.position,
    })),
  };
}
