"use client";

import { create } from "zustand";
import { defaultModel, type Provider } from "@/lib/providers/models";

type ComposerState = {
  provider: Provider | null;
  model: string | null;
  regenerateNodeId: string | null;
  setProvider(provider: Provider | null): void;
  setModel(model: string): void;
  setRegenerateNode(nodeId: string | null): void;
};

export const useComposerStore = create<ComposerState>((set) => ({
  provider: null,
  model: null,
  regenerateNodeId: null,
  setProvider(provider) {
    set({ provider, model: provider ? defaultModel(provider) : null });
  },
  setModel(model) {
    set({ model });
  },
  setRegenerateNode(nodeId) {
    set({ regenerateNodeId: nodeId });
  },
}));
