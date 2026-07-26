"use client";

import { create } from "zustand";

// In-flight streamed text, keyed by node id. Kept OUT of the tldraw shape
// store and out of the graph store's node rows: card bodies subscribe here
// for live tokens, and the shape record never sees intermediate updates.

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
