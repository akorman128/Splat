"use client";

import {
  HIGHLIGHT_COLORS,
  highlightName,
  type HighlightColor,
} from "./palette";

// CSS.highlights is one registry for the whole document, so the expanded card,
// the chat transcript and every card on the canvas would each clobber the
// others' ranges by setting a colour directly. Each of them registers its
// ranges here under its own key instead, and this rebuilds the shared
// Highlight objects from all of them.
const byOwner = new Map<string, Map<HighlightColor, Range[]>>();

export function canPaintHighlights(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS;
}

function flush() {
  if (!canPaintHighlights()) return;
  for (const color of HIGHLIGHT_COLORS) {
    const ranges: Range[] = [];
    for (const owned of byOwner.values()) {
      const own = owned.get(color);
      if (own) ranges.push(...own);
    }
    const name = highlightName(color);
    if (ranges.length === 0) CSS.highlights.delete(name);
    else CSS.highlights.set(name, new Highlight(...ranges));
  }
}

export function setPaintedRanges(
  owner: string,
  ranges: Map<HighlightColor, Range[]>,
): void {
  byOwner.set(owner, ranges);
  flush();
}

export function clearPaintedRanges(owner: string): void {
  if (byOwner.delete(owner)) flush();
}
