"use client";

import { create } from "zustand";
import { defaultModel, type Provider } from "@/lib/providers/models";
import type { ThinkingLevel } from "@/lib/providers/thinking";

type ComposerState = {
  provider: Provider | null;
  model: string | null;
  thinking: ThinkingLevel | null;
  webSearch: boolean;
  regenerateNodeId: string | null;
  setProvider(provider: Provider | null): void;
  setModel(model: string): void;
  setThinking(thinking: ThinkingLevel | null): void;
  setWebSearch(webSearch: boolean): void;
  setRegenerateNode(nodeId: string | null): void;
};

export const useComposerStore = create<ComposerState>((set) => ({
  provider: null,
  model: null,
  thinking: null,
  webSearch: false,
  regenerateNodeId: null,
  setProvider(provider) {
    set({ provider, model: provider ? defaultModel(provider) : null });
  },
  setModel(model) {
    set({ model });
  },
  // Survives a provider change, unlike the model: the levels mean the same
  // thing on all three.
  setThinking(thinking) {
    set({ thinking });
  },
  // Survives a provider change for the same reason: all three search the web
  // themselves, and none of them needs a key of its own to do it.
  setWebSearch(webSearch) {
    set({ webSearch });
  },
  setRegenerateNode(nodeId) {
    set({ regenerateNodeId: nodeId });
  },
}));
