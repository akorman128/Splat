"use client";

import { create } from "zustand";
import type { Provider } from "@/lib/providers/models";

// Current provider selection for the composer, kept in a store so suggestion
// chips on canvas cards can submit with the same selection.

type ComposerState = {
  provider: Provider | null;
  setProvider(provider: Provider | null): void;
};

export const useComposerStore = create<ComposerState>((set) => ({
  provider: null,
  setProvider(provider) {
    set({ provider });
  },
}));
