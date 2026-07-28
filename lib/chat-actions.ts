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

      // A follow-up inherits the card's skills for the same reason it inherits
      // its context: it continues that line of thinking.
      const { data: parentSkills } = await createClient()
        .from("node_skills")
        .select("skill_id")
        .eq("node_id", parent.id)
        .order("position");
      const skillIds = (parentSkills ?? [])
        .map((row) => row.skill_id)
        .filter((id): id is string => id !== null);

      const takenAt = new Date().toISOString();
      graph.markSuggestionTaken(suggestion.id, takenAt);
      markTaken.mutate({ id: suggestion.id, takenAt });

      await chat.mutateAsync({
        request: {
          conversationId: graph.conversationId,
          parentId: parent.id,
          contextNodeIds,
          skillIds,
          // A suggestion is a one-click follow-up with no composer in front of
          // it. Skills carry down the branch because they shape how the model
          // answers; files do not, because re-sending them is the cost this
          // feature exists to avoid.
          attachmentIds: [],
          prompt: suggestion.text,
          provider,
          model: model ?? defaultModel(provider),
          canvasX: position.x,
          canvasY: position.y,
        },
      });
    },
  });
}
