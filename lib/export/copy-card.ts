"use client";

import { toast } from "sonner";
import { useGraphStore } from "@/lib/store/graph-store";
import { responseTextFor, useStreamStore } from "@/lib/store/stream-store";
import { cardMarkdown } from "./markdown";

// Reads the stores rather than taking the text, so the button and the shortcut
// copy the same thing without either having to be near the card's state.
export async function copyCard(nodeId: string) {
  const node = useGraphStore.getState().nodes[nodeId];
  if (!node) return;

  const streamed = useStreamStore.getState().streams[nodeId];
  try {
    await navigator.clipboard.writeText(
      cardMarkdown(node, responseTextFor(node, streamed)),
    );
    toast.success("Card copied");
  } catch {
    toast.error("Could not copy the card");
  }
}
