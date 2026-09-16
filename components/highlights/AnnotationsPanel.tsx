"use client";

import { useEffect, useMemo, useRef } from "react";
import { Highlighter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useGraphStore } from "@/lib/store/graph-store";
import { threadOf } from "@/lib/graph/thread";
import { modifierLabel } from "@/lib/shortcuts";
import { HIGHLIGHT_BORDERS, asHighlightColor } from "@/lib/highlights/palette";
import type { CardHighlight } from "@/lib/types";

// A snippet, not a rendering: the answer is markdown, and three clamped lines
// of it read better without the asterisks and link targets.
function snippet(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s?)/gm, "")
    .replace(/(\*\*|__|`|~~)/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// Where a click lands depends on what is up. In the chat the card is brought
// into the thread only when it is not already there — re-anchoring a card the
// thread runs through would swap every branch below it. On the canvas the
// camera goes to the card, and the passage is scrolled to once it is drawn.
function goTo(nodeId: string, highlight?: CardHighlight) {
  const graph = useGraphStore.getState();
  if (graph.chatOpen) {
    const thread = threadOf(Object.values(graph.nodes), graph.chatAnchorNodeId);
    if (!thread.includes(nodeId)) graph.setChatAnchor(nodeId);
  } else {
    graph.setSelectedNode(nodeId);
    graph.setFocusNode(nodeId);
  }
  if (highlight) graph.requestReveal(highlight);
}

export function AnnotationsPanel() {
  const nodes = useGraphStore((s) => s.nodes);
  const highlights = useGraphStore((s) => s.highlights);
  const anchor = useGraphStore((s) => s.annotationsAnchor);
  const closeAnnotations = useGraphStore((s) => s.closeAnnotations);

  // Oldest first, unlike the badges: the store keeps a card's highlights in
  // reading order, but an overview is read as a record of what was noted.
  const groups = useMemo(
    () =>
      Object.entries(highlights)
        .filter(([id, entries]) => entries.length > 0 && nodes[id])
        .map(([id, entries]) => ({
          id,
          entries: [...entries].sort((a, b) =>
            a.created_at.localeCompare(b.created_at),
          ),
        }))
        .sort((a, b) =>
          a.entries[0].created_at.localeCompare(b.entries[0].created_at),
        ),
    [nodes, highlights],
  );
  const total = groups.reduce((sum, group) => sum + group.entries.length, 0);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !anchor) return;
    const target = scroller.querySelector(
      `[data-annotations-card="${anchor.nodeId}"]`,
    );
    // A card with nothing noted on it has no section to scroll to; the list is
    // left where the reader had it rather than jumped somewhere arbitrary.
    if (!target) return;
    const box = scroller.getBoundingClientRect();
    scroller.scrollTo({
      top: scroller.scrollTop + target.getBoundingClientRect().top - box.top - 8,
    });
  }, [anchor]);

  const hideLabel = `Hide highlights and comments (${modifierLabel()}⇧H)`;

  return (
    <aside className="absolute inset-y-0 right-0 z-[46] flex w-80 max-w-[85vw] flex-col border-l bg-popover text-popover-foreground shadow-xl md:static md:z-auto md:max-w-none md:shrink-0 md:shadow-none">
      <div className="flex shrink-0 items-center gap-2 border-b py-2 pr-2 pl-4">
        <Highlighter className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-sm font-medium">
          Highlights & comments
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {total}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          title={hideLabel}
          onClick={closeAnnotations}
        >
          <X />
          <span className="sr-only">{hideLabel}</span>
        </Button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-2">
        {groups.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Nothing here yet. Open a card and select some text to highlight it,
            ask the model about it, or leave a comment.
          </p>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <section
                key={group.id}
                data-annotations-card={group.id}
                className="space-y-1"
              >
                <button
                  type="button"
                  title="Show this card"
                  onClick={() => goTo(group.id)}
                  className="w-full truncate rounded px-2 py-1 text-left text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {nodes[group.id]?.title ?? "Untitled"}
                </button>
                {group.entries.map((highlight) => (
                  <Entry
                    key={highlight.id}
                    highlight={highlight}
                    onClick={() => goTo(group.id, highlight)}
                  />
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function Entry({
  highlight,
  onClick,
}: {
  highlight: CardHighlight;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      title="Go to this passage"
      onClick={onClick}
      className="w-full space-y-1.5 rounded-md px-2 py-1.5 text-left hover:bg-accent"
    >
      <span
        className={cn(
          "line-clamp-3 block border-l-2 pl-2 text-xs leading-snug text-muted-foreground italic",
          HIGHLIGHT_BORDERS[asHighlightColor(highlight.color)],
        )}
      >
        {highlight.quote}
      </span>
      {highlight.note && (
        <Part label="Answer" text={snippet(highlight.note)} />
      )}
      {highlight.comment && <Part label="Comment" text={highlight.comment} />}
    </button>
  );
}

function Part({ label, text }: { label: string; text: string }) {
  return (
    <span className="block pl-2.5">
      <span className="block text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span className="line-clamp-3 block text-xs leading-snug whitespace-pre-line">
        {text}
      </span>
    </span>
  );
}
