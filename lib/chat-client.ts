"use client";

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useGraphStore } from "@/lib/store/graph-store";
import { useStreamStore } from "@/lib/store/stream-store";
import { apiFetch, apiStream, postJson } from "@/lib/query/api";
import { queryKeys } from "@/lib/query/keys";
import type { Provider } from "@/lib/providers/models";
import type { ChatStreamEvent, NodeRow, SuggestionRow } from "@/lib/types";

export type SubmitParams = {
  conversationId: string;
  parentId: string | null;
  contextNodeIds: string[];
  skillIds: string[];
  attachmentIds: string[];
  prompt: string;
  provider: Provider;
  model: string;
  canvasX: number;
  canvasY: number;
};

export type RegenerateParams = {
  regenerateNodeId: string;
  prompt: string;
  provider: Provider;
  model: string;
  skillIds: string[];
};

export type ChatStreamVariables = {
  request: SubmitParams | RegenerateParams | { retryNodeId: string };
  onNode?: (node: NodeRow) => void;
  onTitled?: (nodeId: string, isRoot: boolean) => void;
};

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
  const createsCard =
    !("regenerateNodeId" in request) && !("retryNodeId" in request);

  const handleEvent = (event: ChatStreamEvent) => {
    const graph = useGraphStore.getState();
    const streams = useStreamStore.getState();
    switch (event.type) {
      case "node":
        nodeId = event.node.id;
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
  }
}
