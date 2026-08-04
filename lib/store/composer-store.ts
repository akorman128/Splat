"use client";

import { create } from "zustand";
import { defaultModel, type Provider } from "@/lib/providers/models";
import type { ThinkingLevel } from "@/lib/providers/thinking";

type ComposerState = {
  provider: Provider | null;
  model: string | null;
  // Null is a choice, not a missing one: it sends no thinking parameter at all.
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
  // Deliberately survives a provider change: the levels mean the same thing on
  // all three, so switching provider is no reason to forget the pick.
  setThinking(thinking) {
    set({ thinking });
  },
  setRegenerateNode(nodeId) {
    set({ regenerateNodeId: nodeId });
  },
}));
