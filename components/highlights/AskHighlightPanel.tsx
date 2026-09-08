"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Loader2, Sparkles, Trash2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, postJson } from "@/lib/query/api";
import { saveNote } from "@/lib/highlights/client";
import { HIGHLIGHT_POPOVER_ATTR } from "@/lib/highlights/dom";
import { QuoteBlock } from "./QuoteBlock";
import type { CardHighlight } from "@/lib/types";

type Answer = { answer: string; model: string };

// Deliberately dashed and labelled: this is the one state where a model
// response is on screen and not yet part of the reader's notes, and the only
// thing separating it from a saved one is that they have not pressed Keep.
export function AskHighlightPanel({
  highlight,
  onDone,
}: {
  highlight: CardHighlight;
  onDone(): void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [saving, setSaving] = useState(false);

  const ask = useMutation<Answer, Error, string>({
    mutationFn: (text) =>
      apiFetch<Answer>(
        "/api/annotate",
        postJson({
          nodeId: highlight.node_id,
          quote: highlight.quote,
          question: text,
        }),
      ),
    onSuccess: setAnswer,
  });

  function submit() {
    if (ask.isPending) return;
    setAnswer(null);
    ask.mutate(question.trim());
  }

  async function keep() {
    if (!answer || saving) return;
    setSaving(true);
    const saved = await saveNote(highlight.id, answer.answer, answer.model);
    setSaving(false);
    if (saved) onDone();
  }

  return (
    <div
      {...{ [HIGHLIGHT_POPOVER_ATTR]: "" }}
      className="pointer-events-auto w-80 max-w-[min(20rem,80vw)] space-y-2 rounded-lg border-2 border-dashed bg-popover p-3 shadow-xl"
    >
      <QuoteBlock color={highlight.color} quote={highlight.quote} />

      {!answer && (
        <>
          <Textarea
            autoFocus
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onDone();
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="What does this mean? (Enter to ask)"
            className="max-h-28 min-h-14 resize-none text-xs"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={ask.isPending}
              onClick={submit}
              className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              {ask.isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Sparkles className="size-3" />
              )}
              {ask.isPending ? "Asking…" : "Ask"}
            </button>
            <button
              type="button"
              onClick={onDone}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {ask.error && (
        <p className="text-xs text-destructive">{ask.error.message}</p>
      )}

      {answer && (
        <>
          <div className="max-h-56 overflow-y-auto">
            <div className="prose prose-sm max-w-none text-xs dark:prose-invert prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-pre:overflow-x-auto prose-pre:text-[10px]">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {answer.answer}
              </ReactMarkdown>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Draft from {answer.model} — not saved yet
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={keep}
              className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Check className="size-3" />
              )}
              Keep
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={onDone}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <Trash2 className="size-3" />
              Discard
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setAnswer(null)}
              className="ml-auto rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              Ask again
            </button>
          </div>
        </>
      )}
    </div>
  );
}
