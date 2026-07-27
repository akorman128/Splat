"use client";

import { useMutation } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useGraphStore } from "@/lib/store/graph-store";
import { useComposerStore } from "@/lib/store/composer-store";
import { useChatStream } from "@/lib/chat-client";
import { defaultModel } from "@/lib/providers/models";
import { parentChain } from "@/lib/graph/ancestors";
import { childPosition } from "@/lib/layout";
import type { SuggestionRow } from "@/lib/types";

/**
 * Marks a suggestion as taken. Optimistic in the graph store and never
 * awaited, so a click starts its stream immediately; a failure only means the
 * chip loses its tick on the next reload.
 *
 * The failure is reported from inside the mutation function rather than an
 * `onError` handler because the chip can unmount while the write is in
 * flight — the request survives that, an observer callback does not.
 */
function useMarkSuggestionTaken() {
  return useMutation({
    mutationFn: async ({ id, takenAt }: { id: string; takenAt: string }) => {
      const { error } = await createClient()
        .from("suggestions")
        .update({ taken_at: takenAt })
        .eq("id", id);
      if (error) {
        console.error("Failed to mark suggestion taken:", error.message);
      }
    },
  });
}

/**
 * Clicking a suggestion chip submits it as the next prompt with that card as
 * parent and the default context (full path from the card back to its root),
 * and marks the suggestion as taken. Stays pending for the whole stream, so
 * the chip that started it reads `isPending` as its own busy state.
 */
export function useSubmitSuggestion() {
  const chat = useChatStream();
  const markTaken = useMarkSuggestionTaken();

  return useMutation<void, Error, SuggestionRow>({
    mutationFn: async (suggestion) => {
      const graph = useGraphStore.getState();
      const parent = graph.nodes[suggestion.node_id];
      if (!parent || !graph.conversationId) {
        throw new Error("Card not loaded");
      }
      const { provider, model } = useComposerStore.getState();
      if (!provider) {
        throw new Error("Connect a provider API key first (Settings).");
      }

      const allNodes = Object.values(graph.nodes);
      const contextNodeIds = parentChain(parent.id, allNodes);
      const position = childPosition(parent, allNodes);

      const takenAt = new Date().toISOString();
      graph.markSuggestionTaken(suggestion.id, takenAt);
      markTaken.mutate({ id: suggestion.id, takenAt });

      await chat.mutateAsync({
        request: {
          conversationId: graph.conversationId,
          parentId: parent.id,
          contextNodeIds,
          prompt: suggestion.text,
          provider,
          // Same selection the composer would send — for a catalogue provider
          // that is whatever the user picked, not the provider's default.
          model: model ?? defaultModel(provider),
          canvasX: position.x,
          canvasY: position.y,
        },
      });
    },
  });
}
