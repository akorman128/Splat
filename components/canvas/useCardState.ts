"use client";

import { useGraphStore } from "@/lib/store/graph-store";
import { useStreamStore } from "@/lib/store/stream-store";

// Both card views — the on-canvas card and the expanded overlay — render the
// same underlying node state. Deriving it in one place stops the two from
// drifting apart (they previously duplicated this, with subtly different
// null handling).

/**
 * While a node is streaming its text lives in the stream store, so the tldraw
 * shape record never sees intermediate tokens. Once the node settles, the
 * persisted `node.response` is authoritative.
 */
export function useCardState(nodeId: string | null) {
  const node = useGraphStore((s) => (nodeId ? s.nodes[nodeId] : undefined));
  const contextCount = useGraphStore((s) =>
    nodeId ? (s.contextCounts[nodeId] ?? 0) : 0,
  );
  const streaming = useStreamStore((s) =>
    nodeId ? s.streams[nodeId] : undefined,
  );

  const isStreaming = node?.status === "streaming";
  const responseText = !node
    ? ""
    : isStreaming && streaming !== undefined
      ? streaming
      : node.response;

  return {
    node,
    responseText,
    contextCount,
    isStreaming: Boolean(isStreaming),
    isError: node?.status === "error",
  };
}

/** "no context" / "3 cards in context" — shared by both footers. */
export function contextLabel(count: number): string {
  if (count === 0) return "no context";
  return `${count} card${count === 1 ? "" : "s"} in context`;
}
