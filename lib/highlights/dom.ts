// A highlight popover is the one place inside a card where the keyboard
// belongs to what has focus: the question box, or a pinned response with its
// edit field. Both the canvas shortcuts and the chat view own the arrow keys,
// Escape and ⌘R everywhere else, and each checks this before acting.
export const HIGHLIGHT_POPOVER_ATTR = "data-highlight-popover";

export function inHighlightPopover(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(`[${HIGHLIGHT_POPOVER_ATTR}]`) !== null
  );
}
