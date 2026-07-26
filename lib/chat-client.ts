"use client";

import { useGraphStore } from "@/lib/store/graph-store";
import { useStreamStore } from "@/lib/store/stream-store";
import type { Provider } from "@/lib/providers/models";
import type { ChatStreamEvent, NodeRow, SuggestionRow } from "@/lib/types";

// Client half of the streaming path. POSTs to /api/chat, parses the NDJSON
// stream, and routes events into the graph/stream stores. The only path from
// the client to a model is this fetch against our own API.

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

type RunCallbacks = {
  /**
   * Fired as soon as the server has created (or reset) the node row, well
   * before the stream finishes. Callers use this to release a submit lock:
   * once the node is in the graph store, auto-layout counts it as a sibling
   * and the next prompt no longer lands on top of it.
   */
  onNode?: (node: NodeRow) => void;
  /** Fired after a node completes and its title/suggestions round-trip lands. */
  onTitled?: (nodeId: string, isRoot: boolean) => void;
};

export async function submitChat(
  params: SubmitParams,
  callbacks: RunCallbacks = {},
): Promise<{ error?: string }> {
  return runStream(params, callbacks);
}

export async function retryChat(
  nodeId: string,
  callbacks: RunCallbacks = {},
): Promise<{ error?: string }> {
  return runStream({ retryNodeId: nodeId }, callbacks);
}

async function runStream(
  body: object,
  callbacks: RunCallbacks,
): Promise<{ error?: string }> {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { error: "Network error — the request never reached the server." };
  }

  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    return {
      error:
        (data as { error?: string }).error ?? `Request failed (${res.status})`,
    };
  }

  const reader = res.body.getReader();
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
        callbacks.onNode?.(event.node);
        break;
      case "delta":
        if (nodeId) streams.append(nodeId, event.text);
        break;
      case "done":
        graph.upsertNode(event.node);
        streams.clear(event.node.id);
        void generateSuggestions(event.node, callbacks);
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
    // surface whatever we have as an interrupted card.
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

  return {};
}

async function generateSuggestions(
  node: { id: string; parent_id: string | null },
  callbacks: RunCallbacks,
) {
  try {
    const res = await fetch("/api/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId: node.id }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      title: string;
      suggestions: SuggestionRow[];
    };
    const graph = useGraphStore.getState();
    const current = graph.nodes[node.id];
    if (current) {
      graph.upsertNode({ ...current, title: data.title });
    }
    graph.setSuggestions(node.id, data.suggestions);
    callbacks.onTitled?.(node.id, node.parent_id === null);
  } catch {
    // Non-fatal: the card simply has no suggestions until a reload retries.
  }
}
