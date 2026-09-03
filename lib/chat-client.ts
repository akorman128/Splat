"use client";

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useGraphStore } from "@/lib/store/graph-store";
import { useStreamStore } from "@/lib/store/stream-store";
import { apiFetch, apiStream, postJson } from "@/lib/query/api";
import { queryKeys } from "@/lib/query/keys";
import type { Provider } from "@/lib/providers/models";
import type { ThinkingLevel } from "@/lib/providers/thinking";
import type { ChatStreamEvent, NodeRow, SuggestionRow } from "@/lib/types";

export type SubmitParams = {
  conversationId: string | null;
  parentId: string | null;
  contextNodeIds: string[];
  skillIds: string[];
  attachmentIds: string[];
  prompt: string;
  provider: Provider;
  model: string;
  thinking: ThinkingLevel | null;
  webSearch: boolean;
  canvasX: number;
  canvasY: number;
};

export type RegenerateParams = {
  regenerateNodeId: string;
  prompt: string;
  provider: Provider;
  model: string;
  thinking: ThinkingLevel | null;
  webSearch: boolean;
  skillIds: string[];
};

export type ChatStreamVariables = {
  request: SubmitParams | RegenerateParams | { retryNodeId: string };
  onNode?: (node: NodeRow) => void;
  onTitled?: (nodeId: string, isRoot: boolean) => void;
};

// Stop is a flag on the row, not a hang-up: nothing about closing this
// connection would reach the run. The card stays streaming until the run reads
// the flag and writes its own terminal status.
export function useStopStream() {
  return useMutation<void, Error, string>({
    mutationFn: async (nodeId) => {
      const { node } = await apiFetch<{ node: NodeRow }>(
        "/api/chat/stop",
        postJson({ nodeId }),
      );
      useGraphStore.getState().upsertNode(node);
    },
  });
}

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
  // A `done` or `error` event is the only thing that ends a card. The body
  // running out is not one: the run behind it may have been killed mid-answer,
  // and reading that as success is what used to leave the card spinning.
  let settled = false;
  const createsCard =
    !("regenerateNodeId" in request) && !("retryNodeId" in request);

  const handleEvent = (event: ChatStreamEvent) => {
    const graph = useGraphStore.getState();
    const streams = useStreamStore.getState();
    switch (event.type) {
      case "node":
        nodeId = event.node.id;
        graph.adoptConversation(event.node.conversation_id);
        streams.clear(event.node.id);
        graph.upsertNode(event.node);
        graph.addEdges(event.edges);
        graph.addAttachments(event.attachments);
        if (createsCard) graph.setFocusNode(event.node.id);
        onNode?.(event.node);
        break;
      case "delta":
        if (nodeId) streams.append(nodeId, event.text);
        break;
      case "done":
        settled = true;
        graph.upsertNode(event.node);
        streams.clear(event.node.id);
        void generateSuggestions(event.node, queryClient, onTitled);
        break;
      case "error":
        settled = true;
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
    // Losing the stream is no longer losing the answer. The run is detached
    // from this request, so it carries on writing the row either way — and
    // StreamWatcher is subscribed to exactly that. Nothing to recover here.
  } finally {
    // The row is the record from here on. Dropping the local delta buffer lets
    // the card read from it, whether the outcome arrives over Realtime or on
    // the next page load.
    if (!settled && nodeId) useStreamStore.getState().clear(nodeId);
  }
}

// Keyed by run, not by card: two callers can now see the same card finish — the
// stream this client opened and the row arriving over Realtime — and React Query
// only dedupes requests that overlap in flight, so the slower ordering pays for
// the model twice. A regenerate mints a new stream_token, so it still asks.
const suggested = new Set<string>();

// Exported because the client that pressed send is no longer guaranteed to be
// the one that sees the card finish — a reload hands that off to StreamWatcher,
// and the title has to follow the answer rather than the connection.
export async function generateSuggestions(
  node: { id: string; parent_id: string | null; stream_token: string | null },
  queryClient: QueryClient,
  onTitled?: ChatStreamVariables["onTitled"],
) {
  const runKey = `${node.id}:${node.stream_token ?? ""}`;
  if (suggested.has(runKey)) return;
  suggested.add(runKey);
  try {
    const data = await queryClient.fetchQuery({
      queryKey: queryKeys.suggestions(node.id),
      queryFn: () =>
        apiFetch<{ title: string; suggestions: SuggestionRow[] }>(
          "/api/suggestions",
          postJson({ nodeId: node.id }),
        ),
      staleTime: 0,
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
    // Left out of the set so the other caller, or a retry, can still try.
    suggested.delete(runKey);
  }
}
