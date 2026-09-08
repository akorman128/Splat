"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Popover } from "@base-ui/react/popover";
import { Check, Loader2, Pencil, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { deleteNote, editNote } from "@/lib/highlights/client";
import { HIGHLIGHT_POPOVER_ATTR } from "@/lib/highlights/dom";
import {
  HIGHLIGHT_SWATCHES,
  asHighlightColor,
} from "@/lib/highlights/palette";
import { QuoteBlock } from "./QuoteBlock";
import type { CardHighlight } from "@/lib/types";

const popoverAttr = { [HIGHLIGHT_POPOVER_ATTR]: "" };

// Collapsed unless the reader means it: hover opens a look at the response, a
// click keeps it open. The popup is a Base UI popover rather than a div next
// to the badge so that it escapes the card's scroll box and tldraw's
// transform, flips when there is no room below, and counts as inside the
// dialog a card may be expanded in — a click on Edit there is not an outside
// press.
export function HighlightBadge({
  highlight,
  index,
  editable,
  style,
}: {
  highlight: CardHighlight;
  index: number;
  editable: boolean;
  style: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (draft === null || busy) return;
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    const saved = await editNote(highlight.id, text);
    setBusy(false);
    if (saved) setDraft(null);
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    await deleteNote(highlight.id);
    setBusy(false);
  }

  const color = asHighlightColor(highlight.color);

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next, details) => {
        if (next) {
          setOpen(true);
          if (details.reason === "trigger-press") setPinned(true);
          return;
        }
        // A click on a badge that hover already opened pins it rather than
        // toggling it shut; wandering off a pinned one, or one with an edit in
        // progress, leaves it where it is.
        if (details.reason === "trigger-press" && !pinned) {
          setPinned(true);
          return;
        }
        if (details.reason === "trigger-hover" && (pinned || draft !== null)) {
          return;
        }
        setOpen(false);
        setPinned(false);
        setDraft(null);
      }}
    >
      <div
        style={style}
        className="pointer-events-auto absolute"
        {...(open ? popoverAttr : {})}
      >
        <Popover.Trigger
          openOnHover
          delay={150}
          closeDelay={150}
          title="Saved response"
          className={cn(
            "flex size-3.5 -translate-y-1/2 items-center justify-center rounded-full text-[8px] leading-none font-semibold text-stone-900 ring-1 ring-foreground/25 transition-transform hover:scale-110",
            HIGHLIGHT_SWATCHES[color],
            pinned && "scale-110 ring-2 ring-primary",
          )}
        >
          {index + 1}
        </Popover.Trigger>
      </div>

      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-[60]"
        >
          <Popover.Popup
            initialFocus={false}
            finalFocus={false}
            {...popoverAttr}
            className="w-72 max-w-[min(18rem,75vw)] space-y-2 rounded-lg border bg-popover p-3 text-popover-foreground shadow-xl outline-none"
          >
            <QuoteBlock color={highlight.color} quote={highlight.quote} />

            {draft === null ? (
              <div className="max-h-56 overflow-y-auto">
                <div className="prose prose-sm max-w-none text-xs dark:prose-invert prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-pre:overflow-x-auto prose-pre:text-[10px]">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {highlight.note ?? ""}
                  </ReactMarkdown>
                </div>
              </div>
            ) : (
              <Textarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setDraft(null);
                  }
                }}
                className="max-h-56 min-h-24 resize-none text-xs"
              />
            )}

            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="truncate">
                {highlight.note_edited_at
                  ? `Edited · ${highlight.note_model}`
                  : highlight.note_model}
              </span>
              {editable && (
                <span className="ml-auto flex shrink-0 items-center gap-0.5">
                  {draft === null ? (
                    <>
                      <button
                        type="button"
                        title="Edit this response"
                        onClick={() => {
                          setPinned(true);
                          setDraft(highlight.note ?? "");
                        }}
                        className="rounded p-1 hover:bg-accent hover:text-foreground"
                      >
                        <Pencil className="size-3" />
                      </button>
                      <button
                        type="button"
                        title="Delete this response — the highlight stays"
                        disabled={busy}
                        onClick={remove}
                        className="rounded p-1 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                      >
                        {busy ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Trash2 className="size-3" />
                        )}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        title="Save"
                        disabled={busy || !draft.trim()}
                        onClick={save}
                        className="rounded p-1 hover:bg-accent hover:text-foreground disabled:opacity-50"
                      >
                        {busy ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Check className="size-3" />
                        )}
                      </button>
                      <button
                        type="button"
                        title="Cancel"
                        disabled={busy}
                        onClick={() => setDraft(null)}
                        className="rounded p-1 hover:bg-accent hover:text-foreground disabled:opacity-50"
                      >
                        <X className="size-3" />
                      </button>
                    </>
                  )}
                </span>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
