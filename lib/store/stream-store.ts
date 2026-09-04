"use client";

import { create } from "zustand";
import type { CardNode } from "@/lib/types";

type StreamState = {
  streams: Record<string, string>;
  append(nodeId: string, text: string): void;
  clear(nodeId: string): void;
};

export const useStreamStore = create<StreamState>((set) => ({
  streams: {},

  append(nodeId, text) {
    set((state) => ({
      streams: {
        ...state.streams,
        [nodeId]: (state.streams[nodeId] ?? "") + text,
      },
    }));
  },

  clear(nodeId) {
    set((state) => {
      if (!(nodeId in state.streams)) return state;
      const next = { ...state.streams };
      delete next[nodeId];
      return { streams: next };
    });
  },
}));

// Two sources feed a running card: deltas from the stream this client opened,
// and the row itself pushed over Realtime for clients that have none. Whichever
// is further along is the one that has seen more of the answer.
export function responseTextFor(
  node: CardNode | undefined,
  streamed: string | undefined,
): string {
  if (!node) return "";
  return node.status === "streaming" &&
    streamed !== undefined &&
    streamed.length > node.response.length
    ? streamed
    : node.response;
}
