"use client";

import { flashRange } from "./paint";

function scrollerAbove(root: HTMLElement): HTMLElement | null {
  for (let el = root.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      el.scrollHeight > el.clientHeight
    ) {
      return el;
    }
  }
  return null;
}

// Scrolls the nearest scroll box rather than calling scrollIntoView: that
// would also scroll every overflow-hidden ancestor, and on the canvas one of
// those is tldraw's container. Rects are viewport pixels and scrollTop is the
// box's own, which differ by the canvas zoom inside a shape.
export function revealRange(root: HTMLElement, range: Range): void {
  const scroller = scrollerAbove(root);
  if (scroller) {
    const box = scroller.getBoundingClientRect();
    const scale = scroller.offsetWidth > 0 ? box.width / scroller.offsetWidth : 1;
    const rect = range.getBoundingClientRect();
    const top = (rect.top - box.top) / scale;
    scroller.scrollBy({
      top: top - scroller.clientHeight / 3,
      behavior: "smooth",
    });
  }
  flashRange(range);
}
