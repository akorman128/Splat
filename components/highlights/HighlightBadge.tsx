"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Popover } from "@base-ui/react/popover";
import { Check, Loader2, Pencil, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGraphStore } from "@/lib/store/graph-store";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_ANNOTATION_LENGTH,
  deleteComment,
  deleteNote,
  editNote,
  saveComment,
} from "@/lib/highlights/client";
import { HIGHLIGHT_POPOVER_ATTR } from "@/lib/highlights/dom";
import {
  HIGHLIGHT_SWATCHES,
  asHighlightColor,
} from "@/lib/highlights/palette";
import { QuoteBlock } from "./QuoteBlock";
import type { CardHighlight } from "@/lib/types";

const popoverAttr = { [HIGHLIGHT_POPOVER_ATTR]: "" };

type Part = "note" | "comment";

function badgeTitle(highlight: CardHighlight): string {
  if (highlight.note && highlight.comment) return "Saved response and comment";
  return highlight.note ? "Saved response" : "Comment";
}

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
  const [editing, setEditing] = useState<Part | null>(null);
  const readOnly = useGraphStore((s) => s.readOnly);

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
        if (details.reason === "trigger-hover" && (pinned || editing)) {
          return;
        }
        setOpen(false);
        setPinned(false);
        setEditing(null);
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
          title={badgeTitle(highlight)}
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

            {highlight.note && (
              <Section
                text={highlight.note}
                markdown
                label={
                  highlight.note_edited_at
                    ? `Edited · ${highlight.note_model}`
                    : (highlight.note_model ?? "")
                }
                editable={editable}
                editing={editing === "note"}
                onEdit={() => {
                  setPinned(true);
                  setEditing("note");
                }}
                onCancel={() => setEditing(null)}
                onSave={(text) => editNote(highlight.id, text)}
                onDelete={() => deleteNote(highlight.id)}
                deleteTitle="Delete this response — the highlight stays"
              />
            )}

            {highlight.note && highlight.comment && (
              <hr className="border-border" />
            )}

            {highlight.comment && (
              <Section
                text={highlight.comment}
                label={readOnly ? "Comment" : "Your comment"}
                editable={editable}
                editing={editing === "comment"}
                onEdit={() => {
                  setPinned(true);
                  setEditing("comment");
                }}
                onCancel={() => setEditing(null)}
                onSave={(text) => saveComment(highlight.id, text)}
                onDelete={() => deleteComment(highlight.id)}
                deleteTitle="Delete this comment — the highlight stays"
              />
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Section({
  text,
  markdown = false,
  label,
  editable,
  editing,
  onEdit,
  onCancel,
  onSave,
  onDelete,
  deleteTitle,
}: {
  text: string;
  markdown?: boolean;
  label: string;
  editable: boolean;
  editing: boolean;
  onEdit(): void;
  onCancel(): void;
  onSave(text: string): Promise<unknown>;
  onDelete(): Promise<unknown>;
  deleteTitle: string;
}) {
  // null means "nothing unsaved here". The draft is kept when the badge moves
  // its edit to the other section, so writing half an answer, stepping over to
  // the comment and coming back does not throw the half away; an explicit
  // cancel, or a save, is what discards it.
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = draft ?? text;

  function cancel() {
    setDraft(null);
    onCancel();
  }

  async function save() {
    const next = value.trim();
    if (!next || busy) return;
    setBusy(true);
    const saved = await onSave(next);
    setBusy(false);
    if (saved) cancel();
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    await onDelete();
    setBusy(false);
  }

  return (
    <>
      {!editing ? (
        <div className="max-h-56 overflow-y-auto">
          {markdown ? (
            <div className="prose prose-sm max-w-none text-xs dark:prose-invert prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-pre:overflow-x-auto prose-pre:text-[10px]">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-xs whitespace-pre-wrap">{text}</p>
          )}
        </div>
      ) : (
        <Textarea
          autoFocus
          maxLength={MAX_ANNOTATION_LENGTH}
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancel();
            }
          }}
          className="max-h-56 min-h-24 resize-none text-xs"
        />
      )}

      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span className="truncate">{label}</span>
        {editable && (
          <span className="ml-auto flex shrink-0 items-center gap-0.5">
            {!editing ? (
              <>
                <button
                  type="button"
                  title="Edit"
                  onClick={onEdit}
                  className="rounded p-1 hover:bg-accent hover:text-foreground"
                >
                  <Pencil className="size-3" />
                </button>
                <button
                  type="button"
                  title={deleteTitle}
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
                  disabled={busy || !value.trim()}
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
                  onClick={cancel}
                  className="rounded p-1 hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  <X className="size-3" />
                </button>
              </>
            )}
          </span>
        )}
      </div>
    </>
  );
}
