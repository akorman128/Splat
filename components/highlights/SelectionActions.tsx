"use client";

import { Highlighter, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { HIGHLIGHT_SWATCHES, type HighlightColor } from "@/lib/highlights/palette";

// Two actions on a quote, and the same bar is what takes one back off again:
// selecting inside a highlight that is already there offers to remove it, and
// asking from inside one hangs the answer on the quote that exists rather than
// laying a second one over it.
export function SelectionActions({
  color,
  busy,
  isHighlighted,
  existingHasNote,
  onHighlight,
  onAsk,
}: {
  color: HighlightColor;
  busy: boolean;
  isHighlighted: boolean;
  existingHasNote: boolean;
  onHighlight(): void;
  onAsk(): void;
}) {
  return (
    <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg border bg-popover p-1 shadow-lg">
      <button
        type="button"
        disabled={busy}
        onClick={onHighlight}
        title={
          existingHasNote
            ? "Remove this highlight and the response saved against it"
            : undefined
        }
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50",
          isHighlighted && "text-destructive hover:bg-destructive/10",
        )}
      >
        <Highlighter className="size-3.5 opacity-70" />
        {isHighlighted ? "Remove" : "Highlight"}
        {!isHighlighted && (
          <span
            className={cn(
              "size-2.5 rounded-full ring-1 ring-foreground/15",
              HIGHLIGHT_SWATCHES[color],
            )}
          />
        )}
      </button>
      <span className="h-4 w-px bg-border" />
      <button
        type="button"
        disabled={busy}
        onClick={onAsk}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
      >
        <Sparkles className="size-3.5 text-muted-foreground" />
        Ask model
      </button>
    </div>
  );
}
