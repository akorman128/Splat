"use client";

import { create } from "zustand";
import {
  DEFAULT_HIGHLIGHT_COLOR,
  type HighlightColor,
} from "@/lib/highlights/palette";

// Account settings the canvas needs where props cannot reach: a card is drawn
// inside a tldraw shape, so nothing the layout loaded can be threaded down to
// it. Seeded once by ConversationShell from the row the layout already read.
type SettingsState = {
  highlightColor: HighlightColor;
  setHighlightColor(color: HighlightColor): void;
};

export const useSettingsStore = create<SettingsState>((set) => ({
  highlightColor: DEFAULT_HIGHLIGHT_COLOR,
  setHighlightColor(highlightColor) {
    set({ highlightColor });
  },
}));
