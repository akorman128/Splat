"use client";

import { useEffect } from "react";
import { useGraphStore } from "@/lib/store/graph-store";
import { useComposerStore } from "@/lib/store/composer-store";
import { useAttachmentStore } from "@/lib/store/attachment-store";
import { sweepAttachments } from "@/lib/attachments-client";
import type {
  CardAttachment,
  ContextEdgeRow,
  NodeRow,
  SuggestionRow,
} from "@/lib/types";

// Being the page rather than the shell is the point — this is the only thing
// that unmounts when a draft turns into a conversation.
export function GraphHydrator({
  conversationId,
  nodes,
  edges,
  suggestions,
  attachments,
}: {
  conversationId: string | null;
  nodes: NodeRow[];
  edges: ContextEdgeRow[];
  suggestions: SuggestionRow[];
  attachments: CardAttachment[];
}) {
  useEffect(() => {
    const graph = useGraphStore.getState();
    // Skip if the store already adopted this id — a draft's first card streaming
    // in, or a file attached before the first prompt. Re-initing would wipe the
    // card mid-stream, and the reset would drop the chips that created the
    // conversation in the first place.
    if (graph.conversationId !== conversationId) {
      graph.init({ conversationId, nodes, edges, suggestions, attachments });
      useComposerStore.getState().setRegenerateNode(null);
      useAttachmentStore.getState().reset();
    }
    if (conversationId) sweepAttachments(conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  return null;
}
