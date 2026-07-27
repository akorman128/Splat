"use client";

import { create } from "zustand";

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
