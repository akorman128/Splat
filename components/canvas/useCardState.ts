"use client";

import { useGraphStore } from "@/lib/store/graph-store";
import { responseTextFor, useStreamStore } from "@/lib/store/stream-store";
import type { CardAttachment } from "@/lib/types";

// Shared so a card with no files keeps returning the same reference — `?? []`
// here would make every card re-render on every store change.
const NONE: CardAttachment[] = [];

export function useCardState(nodeId: string | null) {
  const node = useGraphStore((s) => (nodeId ? s.nodes[nodeId] : undefined));
  const contextCount = useGraphStore((s) =>
    nodeId ? (s.contextCounts[nodeId] ?? 0) : 0,
  );
  const attachments = useGraphStore((s) =>
    nodeId ? (s.attachments[nodeId] ?? NONE) : NONE,
  );
  const streaming = useStreamStore((s) =>
    nodeId ? s.streams[nodeId] : undefined,
  );

  return {
    node,
    responseText: responseTextFor(node, streaming),
    contextCount,
    attachments,
    isStreaming: Boolean(node?.status === "streaming"),
    isError: node?.status === "error",
  };
}

export function contextLabel(count: number): string {
  if (count === 0) return "no context";
  return `${count} card${count === 1 ? "" : "s"} in context`;
}
