"use client";

import { create } from "zustand";
import { defaultModel, type Provider } from "@/lib/providers/models";

// Current provider + model selection for the composer, kept in a store so
// suggestion chips on canvas cards can submit with the same selection.

type ComposerState = {
  provider: Provider | null;
  /** User-chosen for catalogue providers; the pinned id for the others. */
  model: string | null;
  setProvider(provider: Provider | null): void;
  setModel(model: string): void;
};

export const useComposerStore = create<ComposerState>((set) => ({
  provider: null,
  model: null,
  setProvider(provider) {
    // A model id belongs to exactly one provider, so switching provider has to
    // reset it. Carrying an OpenRouter id over to, say, Anthropic would be
    // rejected by /api/chat's model check — after the composer had already
    // cleared the prompt box.
    set({ provider, model: provider ? defaultModel(provider) : null });
  },
  setModel(model) {
    set({ model });
  },
}));
