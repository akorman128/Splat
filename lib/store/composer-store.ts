"use client";

import { create } from "zustand";
import { defaultModel, type Provider } from "@/lib/providers/models";
import type { ThinkingLevel } from "@/lib/providers/thinking";

type ComposerState = {
  provider: Provider | null;
  model: string | null;
  thinking: ThinkingLevel | null;
  regenerateNodeId: string | null;
  setProvider(provider: Provider | null): void;
  setModel(model: string): void;
  setThinking(thinking: ThinkingLevel | null): void;
  setRegenerateNode(nodeId: string | null): void;
};

export const useComposerStore = create<ComposerState>((set) => ({
  provider: null,
  model: null,
  thinking: null,
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
  setRegenerateNode(nodeId) {
    set({ regenerateNodeId: nodeId });
  },
}));
