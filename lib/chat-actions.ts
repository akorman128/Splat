"use client";

import { createClient } from "@/lib/supabase/client";
import { useGraphStore } from "@/lib/store/graph-store";
import { useComposerStore } from "@/lib/store/composer-store";
import { submitChat } from "@/lib/chat-client";
import { defaultModel } from "@/lib/providers/models";
import { parentChain } from "@/lib/graph/ancestors";
import { childPosition } from "@/lib/layout";
import type { SuggestionRow } from "@/lib/types";

/**
 * Clicking a suggestion chip submits it as the next prompt with that card as
 * parent and the default context (full path from the card back to its root),
 * and marks the suggestion as taken.
 */
export async function submitSuggestion(
  suggestion: SuggestionRow,
): Promise<{ error?: string }> {
  const graph = useGraphStore.getState();
  const parent = graph.nodes[suggestion.node_id];
  if (!parent || !graph.conversationId) {
    return { error: "Card not loaded" };
  }
  const { provider, model } = useComposerStore.getState();
  if (!provider) {
    return { error: "Connect a provider API key first (Settings)." };
  }

  const allNodes = Object.values(graph.nodes);
  const contextNodeIds = parentChain(parent.id, allNodes);
  const position = childPosition(parent, allNodes);

  const takenAt = new Date().toISOString();
  graph.markSuggestionTaken(suggestion.id, takenAt);
  // Supabase builders are lazy — .then() is what fires the request.
  createClient()
    .from("suggestions")
    .update({ taken_at: takenAt })
    .eq("id", suggestion.id)
    .then(({ error }) => {
      if (error) {
        console.error("Failed to mark suggestion taken:", error.message);
      }
    });

  return submitChat({
    conversationId: graph.conversationId,
    parentId: parent.id,
    contextNodeIds,
    prompt: suggestion.text,
    provider,
    // Same selection the composer would send — for a catalogue provider that
    // is whatever the user picked, not the provider's default.
    model: model ?? defaultModel(provider),
    canvasX: position.x,
    canvasY: position.y,
  });
}
