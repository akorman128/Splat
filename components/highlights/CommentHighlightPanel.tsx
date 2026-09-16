"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { saveComment } from "@/lib/highlights/client";
import { HIGHLIGHT_POPOVER_ATTR } from "@/lib/highlights/dom";
import { QuoteBlock } from "./QuoteBlock";
import type { CardHighlight } from "@/lib/types";

export function CommentHighlightPanel({
  highlight,
  onDone,
}: {
  highlight: CardHighlight;
  onDone(): void;
}) {
  const [draft, setDraft] = useState(highlight.comment ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    const saved = await saveComment(highlight.id, text);
    setSaving(false);
    if (saved) onDone();
  }

  return (
    <div
      {...{ [HIGHLIGHT_POPOVER_ATTR]: "" }}
      className="pointer-events-auto w-80 max-w-[min(20rem,80vw)] space-y-2 rounded-lg border bg-popover p-3 shadow-xl"
    >
      <QuoteBlock color={highlight.color} quote={highlight.quote} />
      <Textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onDone();
            return;
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            save();
          }
        }}
        placeholder="Leave a comment (Enter to save)"
        className="max-h-40 min-h-14 resize-none text-xs"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={saving || !draft.trim()}
          onClick={save}
          className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Check className="size-3" />
          )}
          Save
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onDone}
          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
