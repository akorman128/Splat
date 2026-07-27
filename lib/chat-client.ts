"use client";

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useGraphStore } from "@/lib/store/graph-store";
import { useStreamStore } from "@/lib/store/stream-store";
import { apiFetch, apiStream, postJson } from "@/lib/query/api";
import { queryKeys } from "@/lib/query/keys";
import type { Provider } from "@/lib/providers/models";
import type { ChatStreamEvent, NodeRow, SuggestionRow } from "@/lib/types";

// Client half of the streaming path. POSTs to /api/chat, parses the NDJSON
// stream, and routes events into the graph/stream stores. The only path from
// the client to a model is this mutation against our own API.

export type SubmitParams = {
  conversationId: string;
  parentId: string | null;
  contextNodeIds: string[];
  prompt: string;
  provider: Provider;
  model: string;
  canvasX: number;
  canvasY: number;
};

export type ChatStreamVariables = {
  request: SubmitParams | { retryNodeId: string };
  /**
   * Fired as soon as the server has created (or reset) the node row, well
   * before the stream finishes — so it cannot be the mutation's own settled
   * state. Callers use this to release a submit lock: once the node is in the
   * graph store, auto-layout counts it as a sibling and the next prompt no
   * longer lands on top of it.
   */
  onNode?: (node: NodeRow) => void;
  /** Fired after a node completes and its title/suggestions round-trip lands. */
  onTitled?: (nodeId: string, isRoot: boolean) => void;
};

/**
 * Mutations do not retry by default, which is what this one needs: the server
 * claims the node row before the first token, so a second attempt would race
 * the first one's writes onto the same row.
 */
export function useChatStream() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, ChatStreamVariables>({
    mutationFn: (variables) => runStream(variables, queryClient),
  });
}

async function runStream(
  { request, onNode, onTitled }: ChatStreamVariables,
  queryClient: QueryClient,
): Promise<void> {
  const body = await apiStream("/api/chat", request);

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let nodeId: string | null = null;

  const handleEvent = (event: ChatStreamEvent) => {
    const graph = useGraphStore.getState();
    const streams = useStreamStore.getState();
    switch (event.type) {
      case "node":
        nodeId = event.node.id;
        streams.clear(event.node.id);
        graph.upsertNode(event.node);
        graph.addEdges(event.edges);
        onNode?.(event.node);
        break;
      case "delta":
        if (nodeId) streams.append(nodeId, event.text);
        break;
      case "done":
        graph.upsertNode(event.node);
        streams.clear(event.node.id);
        void generateSuggestions(event.node, queryClient, onTitled);
        break;
      case "error":
        if (event.node) graph.upsertNode(event.node);
        if (nodeId) streams.clear(nodeId);
        break;
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        handleEvent(JSON.parse(line) as ChatStreamEvent);
      }
    }
  } catch {
    // Connection dropped mid-stream. The server persists the partial and
    // marks the node errored; refetching on next load shows it. Locally,
    // surface whatever we have as an interrupted card — and resolve rather
    // than reject, because the caller's error toast would be a second, less
    // useful report of what the card now says itself.
    if (nodeId) {
      const graph = useGraphStore.getState();
      const streams = useStreamStore.getState();
      const node = graph.nodes[nodeId];
      const partial = streams.streams[nodeId] ?? "";
      if (node && node.status === "streaming") {
        graph.upsertNode({
          ...node,
          response: partial,
          status: "error",
          error_message: "Connection lost while streaming",
        });
      }
      streams.clear(nodeId);
    }
  }
}

/**
 * Generating follow-ups is fired from inside the stream's `done` event, where
 * there is no component to hold a mutation observer — so it goes through the
 * query client directly. Keyed by node so two cards finishing at once cannot
 * overwrite each other's result, and deduped if the same node somehow asks
 * twice.
 */
async function generateSuggestions(
  node: { id: string; parent_id: string | null },
  queryClient: QueryClient,
  onTitled: ChatStreamVariables["onTitled"],
) {
  try {
    const data = await queryClient.fetchQuery({
      queryKey: queryKeys.suggestions(node.id),
      queryFn: () =>
        apiFetch<{ title: string; suggestions: SuggestionRow[] }>(
          "/api/suggestions",
          postJson({ nodeId: node.id }),
        ),
      // Retrying a node regenerates its response, and the route replaces the
      // stored follow-ups to match. A cached entry must never stand in for
      // that call.
      staleTime: 0,
      // This is a POST with side effects riding on query machinery, so it must
      // opt out of the client's default read retry: the route bills the user's
      // own key for a model call and replaces the node's suggestion rows, and
      // it answers a provider failure with 502 — which that default would
      // otherwise treat as worth a second attempt.
      retry: false,
    });
    const graph = useGraphStore.getState();
    const current = graph.nodes[node.id];
    if (current) {
      graph.upsertNode({ ...current, title: data.title });
    }
    graph.setSuggestions(node.id, data.suggestions);
    onTitled?.(node.id, node.parent_id === null);
  } catch {
    // Non-fatal: the card simply has no suggestions until a reload retries.
  }
}
