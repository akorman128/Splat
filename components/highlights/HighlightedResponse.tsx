"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useGraphStore } from "@/lib/store/graph-store";
import { useSettingsStore } from "@/lib/store/settings-store";
import {
  anchorFromRange,
  locateAnchor,
  rangeForAnchor,
  textMapOf,
  type TextAnchor,
} from "@/lib/highlights/anchor";
import { clearPaintedRanges, setPaintedRanges } from "@/lib/highlights/paint";
import { revealRange } from "@/lib/highlights/reveal";
import {
  asHighlightColor,
  type HighlightColor,
} from "@/lib/highlights/palette";
import { createHighlight, deleteHighlight } from "@/lib/highlights/client";
import { SelectionActions } from "./SelectionActions";
import { AskHighlightPanel } from "./AskHighlightPanel";
import { CommentHighlightPanel } from "./CommentHighlightPanel";
import { HighlightBadge } from "./HighlightBadge";
import type { CardHighlight } from "@/lib/types";

const NONE: CardHighlight[] = [];
const NO_BADGES: Badge[] = [];

const TOOLBAR_WIDTH = 330;
const PANEL_WIDTH = 320;

// The same card is drawn on more than one of these at once — the canvas card
// stays mounted under the chat overlay and under an expanded card — so a jump
// to a passage has to name which of them the reader is actually looking at.
type Surface = "canvas" | "chat" | "expanded";

type Spot = { top: number; left: number };

type Badge = Spot & { highlight: CardHighlight };

function sameBadges(a: Badge[], b: Badge[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (badge, i) =>
        badge.highlight === b[i].highlight &&
        badge.top === b[i].top &&
        badge.left === b[i].left,
    )
  );
}

type Open = Spot & { id: string; kind: "ask" | "comment" };

type Pending = Spot & {
  anchor: TextAnchor;
  // The highlight this selection already sits inside, when it does: asking a
  // second question about a passage should hang off the quote that is already
  // there rather than stacking another one on top of it.
  existing: CardHighlight | null;
};

function anchorOf(highlight: CardHighlight): TextAnchor {
  return {
    quote: highlight.quote,
    prefix: highlight.prefix,
    suffix: highlight.suffix,
    textOffset: highlight.text_offset,
  };
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(value, Math.max(0, max)));
}

// Client rects are in viewport pixels; the overlay is laid out in the root's
// own pixels. Inside a tldraw shape the two differ by the canvas zoom, so a
// badge placed from a raw rect drifts as soon as the camera is not at 1:1.
function overlayScale(root: HTMLElement, rootRect: DOMRect): number {
  return root.offsetWidth > 0 ? rootRect.width / root.offsetWidth : 1;
}

// A card's answer, with the reader's highlights painted over it and a badge
// against each one that kept a response.
//
// `interactive` is what separates a reading surface from the canvas: a card
// inside a tldraw shape shows its highlights and its saved answers but offers
// no selection toolbar, because dragging across text there is how a card is
// moved.
export function HighlightedResponse({
  nodeId,
  text,
  className,
  interactive = false,
  surface = "canvas",
}: {
  nodeId: string;
  text: string;
  className?: string;
  interactive?: boolean;
  surface?: Surface;
}) {
  const highlights = useGraphStore((s) => s.highlights[nodeId] ?? NONE);
  const onScreen = useGraphStore((s) =>
    s.chatOpen
      ? surface === "chat"
      : s.expandedNodeId === nodeId
        ? surface === "expanded"
        : surface === "canvas",
  );
  const reveal = useGraphStore((s) =>
    s.revealHighlight?.nodeId === nodeId ? s.revealHighlight : null,
  );
  const color = useSettingsStore((s) => s.highlightColor);
  const rootRef = useRef<HTMLDivElement>(null);
  const owner = useId();

  const [badges, setBadges] = useState<Badge[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [busy, setBusy] = useState(false);

  // Paints the ranges and hands back where the badges go; the callers own the
  // state write, so a card with nothing to paint costs no DOM walk and no
  // re-render on any of the streaming tokens that re-run this.
  const paint = useCallback(
    (root: HTMLElement): Badge[] => {
      if (highlights.length === 0) {
        clearPaintedRanges(owner);
        return NO_BADGES;
      }
      const map = textMapOf(root);
      const rootRect = root.getBoundingClientRect();
      const scale = overlayScale(root, rootRect);
      const width = rootRect.width / scale;
      const painted = new Map<HighlightColor, Range[]>();
      const next: Badge[] = [];

      for (const highlight of highlights) {
        // Null when a regenerate rewrote the answer out from under the quote.
        // The row stays; it simply has nothing to point at right now.
        const range = rangeForAnchor(map, anchorOf(highlight));
        if (!range) continue;

        const key = asHighlightColor(highlight.color);
        const ranges = painted.get(key) ?? [];
        ranges.push(range);
        painted.set(key, ranges);

        if (!highlight.note && !highlight.comment) continue;
        const rects = range.getClientRects();
        const last = rects[rects.length - 1];
        if (!last) continue;
        // Raised like a footnote mark rather than centred on the line: at
        // mid-height a badge sits on top of the next word.
        next.push({
          highlight,
          top: (last.top - rootRect.top) / scale + 4,
          left: clamp((last.right - rootRect.left) / scale + 2, width - 6),
        });
      }

      setPaintedRanges(owner, painted);
      return next;
    },
    [highlights, owner],
  );

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const next = paint(root);
    setBadges((prev) => (sameBadges(prev, next) ? prev : next));
  }, [paint, text]);

  useEffect(() => () => clearPaintedRanges(owner), [owner]);

  // Only the copy the reader is looking at: every surface drawing this card
  // runs this effect on the same commit, and clearing the request does not
  // stop the others in that pass — a hidden canvas card would scroll its own
  // box out from under them. Left set until that surface has had its turn,
  // because a card culled off the canvas mounts only once the camera arrives.
  useEffect(() => {
    const root = rootRef.current;
    if (!reveal || !root || !onScreen) return;
    const highlight = highlights.find((h) => h.id === reveal.id);
    const range = highlight
      ? rangeForAnchor(textMapOf(root), anchorOf(highlight))
      : null;
    // Cleared even with nothing to point at: a quote a regenerate rewrote
    // away is not going to resolve on a later pass either.
    if (range) revealRange(root, range);
    useGraphStore.getState().clearReveal();
  }, [reveal, onScreen, highlights, text]);

  // Reflowing the prose moves every rect the badges were placed from — a
  // window resize, the chat panel opening, a code block finishing its layout.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(() => {
      const next = paint(root);
      setBadges((prev) => (sameBadges(prev, next) ? prev : next));
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [paint]);

  useEffect(() => {
    if (!interactive) return;
    const root = rootRef.current;
    if (!root) return;

    const onPointerUp = (event: PointerEvent) => {
      const target = event.target as Node | null;
      const element =
        target instanceof Element ? target : (target?.parentElement ?? null);
      // Releasing on the toolbar is what dismisses the toolbar otherwise: the
      // click that follows would find nothing left to act on.
      if (element?.closest("[data-highlight-skip]")) return;

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setPending(null);
        return;
      }
      const range = selection.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) {
        setPending(null);
        return;
      }
      const map = textMapOf(root);
      const anchor = anchorFromRange(map, range);
      if (!anchor) {
        setPending(null);
        return;
      }

      const plain = map.text;
      const start = locateAnchor(plain, anchor) ?? anchor.textOffset;
      const end = start + anchor.quote.length;
      const existing =
        highlights.find((h) => {
          const at = locateAnchor(plain, anchorOf(h));
          return at !== null && at < end && start < at + h.quote.length;
        }) ?? null;

      const rootRect = root.getBoundingClientRect();
      const scale = overlayScale(root, rootRect);
      const rect = range.getBoundingClientRect();
      setPending({
        anchor,
        existing,
        top: (rect.bottom - rootRect.top) / scale + 6,
        left: clamp(
          (rect.left - rootRect.left) / scale,
          rootRect.width / scale - TOOLBAR_WIDTH,
        ),
      });
    };

    document.addEventListener("pointerup", onPointerUp);
    return () => document.removeEventListener("pointerup", onPointerUp);
  }, [interactive, highlights]);

  function dismiss() {
    setPending(null);
    window.getSelection()?.removeAllRanges();
  }

  async function toggleHighlight() {
    if (!pending || busy) return;
    setBusy(true);
    if (pending.existing) {
      await deleteHighlight(nodeId, pending.existing.id);
    } else {
      await createHighlight(nodeId, pending.anchor, color);
    }
    setBusy(false);
    dismiss();
  }

  async function openPanel(kind: Open["kind"]) {
    if (!pending || busy) return;
    setBusy(true);
    const highlight =
      pending.existing ??
      (await createHighlight(nodeId, pending.anchor, color));
    setBusy(false);
    if (!highlight) return;
    const spot = {
      top: pending.top,
      left: clamp(
        pending.left,
        (rootRef.current?.clientWidth ?? PANEL_WIDTH) - PANEL_WIDTH,
      ),
    };
    dismiss();
    setOpen({ ...spot, id: highlight.id, kind });
  }

  // Read back out of the store so a note saved from the panel, or the row
  // arriving changed, is what the panel is holding.
  const openHighlight = open
    ? (highlights.find((h) => h.id === open.id) ?? null)
    : null;

  function closePanel() {
    setOpen(null);
    setPending(null);
  }

  return (
    <div ref={rootRef} className="relative">
      <div className={className}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>

      <div
        data-highlight-skip
        className="pointer-events-none absolute inset-0"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {badges.map((badge, index) => (
          <HighlightBadge
            key={badge.highlight.id}
            highlight={badge.highlight}
            index={index}
            editable={interactive}
            style={{ top: badge.top, left: badge.left }}
          />
        ))}

        {pending && !openHighlight && (
          <div
            className="absolute z-20"
            style={{ top: pending.top, left: pending.left }}
          >
            <SelectionActions
              color={color}
              busy={busy}
              existingHasNote={Boolean(pending.existing?.note)}
              existingHasComment={Boolean(pending.existing?.comment)}
              isHighlighted={Boolean(pending.existing)}
              onHighlight={toggleHighlight}
              onAsk={() => openPanel("ask")}
              onComment={() => openPanel("comment")}
            />
          </div>
        )}

        {open && openHighlight && (
          <div
            className="absolute z-30"
            style={{ top: open.top, left: open.left }}
          >
            {open.kind === "ask" ? (
              <AskHighlightPanel highlight={openHighlight} onDone={closePanel} />
            ) : (
              <CommentHighlightPanel
                highlight={openHighlight}
                onDone={closePanel}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
