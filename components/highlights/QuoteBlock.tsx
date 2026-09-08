"use client";

import { cn } from "@/lib/utils";
import { HIGHLIGHT_BORDERS, asHighlightColor } from "@/lib/highlights/palette";

// What keeps a response tied to its passage once the popover covers the text
// it came from: the quote is repeated at the top, in the colour it was
// highlighted in.
export function QuoteBlock({
  color,
  quote,
}: {
  color: string;
  quote: string;
}) {
  return (
    <p
      className={cn(
        "line-clamp-3 border-l-2 pl-2 text-[11px] leading-snug text-muted-foreground italic",
        HIGHLIGHT_BORDERS[asHighlightColor(color)],
      )}
    >
      {quote}
    </p>
  );
}
