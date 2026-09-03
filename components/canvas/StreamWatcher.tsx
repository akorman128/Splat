"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { generateSuggestions } from "@/lib/chat-client";
import { apiFetch, postJson } from "@/lib/query/api";
import { isStaleStream, STALE_STREAM_MS } from "@/lib/streams/stale";
import { useGraphStore } from "@/lib/store/graph-store";
import { useStreamStore } from "@/lib/store/stream-store";
import type { NodeRow } from "@/lib/types";

// Draws nothing. The run that fills a card no longer belongs to the request
// that started it, so a card can be mid-answer with nobody holding a stream to
// it — after a reload, in a second tab, on another device. This is how those
// clients find out what happened: the run writes the row every couple of
// seconds, and Postgres pushes the row here.
//
// The direct stream on /api/chat is still the fast path for the client that
// pressed send. This is the one that survives it.
export function StreamWatcher({ conversationId }: { conversationId: string }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`nodes:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "nodes",
          filter: `conversation_id=eq.${conversationId}`,
        },
        ({ new: row }) => {
          const node = row as NodeRow;
          const graph = useGraphStore.getState();
          const known = graph.nodes[node.id];
          // A card this client has never seen arrives by hydration, not here —
          // the row alone carries no edges, attachments or suggestions.
          if (!known) return;
          graph.upsertNode(node);
          if (node.status !== "streaming") {
            // The local delta buffer only ever held a guess at the answer; the
            // row now holds the whole of it.
            useStreamStore.getState().clear(node.id);
          }
          // The run writes the answer but not the title — that is still a
          // client call. Firing it here is what stops a card finished while
          // nobody was streaming from staying "Untitled" forever.
          if (
            known.status === "streaming" &&
            node.status === "complete" &&
            !node.title
          ) {
            void generateSuggestions(node, queryClient);
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, queryClient]);

  // Realtime only carries what a run writes, so a run killed before it could
  // write anything says nothing at all — and the card spins until someone
  // reloads. This is the page noticing that silence for itself.
  useEffect(() => {
    let cancelled = false;

    const sweep = async () => {
      const graph = useGraphStore.getState();
      if (!Object.values(graph.nodes).some(isStaleStream)) return;
      try {
        const { nodes } = await apiFetch<{ nodes: NodeRow[] }>(
          "/api/chat/reclaim",
          postJson({ conversationId }),
        );
        if (cancelled) return;
        for (const node of nodes) useGraphStore.getState().upsertNode(node);
      } catch {
      }
    };

    // A third of the window: a card cannot be stale for longer than that before
    // a check lands on it, and an idle canvas costs one store read a minute.
    const timer = setInterval(sweep, Math.round(STALE_STREAM_MS / 3));
    void sweep();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [conversationId]);

  return null;
}
