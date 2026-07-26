"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { useGraphStore } from "@/lib/store/graph-store";
import { submitSuggestion } from "@/lib/chat-actions";
import type { SuggestionRow } from "@/lib/types";

// Three clickable suggestion chips to the right of a card. Suggestions are
// persisted data on the node — generated eagerly by the utility model when
// the response completes, surviving reload.

const stop = (e: React.PointerEvent) => e.stopPropagation();

export function SuggestionRail({ nodeId }: { nodeId: string }) {
  const suggestions = useGraphStore((s) => s.suggestions[nodeId]);
  const status = useGraphStore((s) => s.nodes[nodeId]?.status);

  if (!suggestions || suggestions.length === 0 || status !== "complete") {
    return null;
  }

  return (
    <div
      className="absolute top-2 flex w-60 flex-col gap-2"
      style={{ left: "calc(100% + 20px)", pointerEvents: "all" }}
    >
      {suggestions.map((s) => (
        <Chip key={s.id} suggestion={s} />
      ))}
    </div>
  );
}

function Chip({ suggestion }: { suggestion: SuggestionRow }) {
  const [busy, setBusy] = useState(false);
  const taken = suggestion.taken_at !== null;

  async function click() {
    if (taken || busy) return;
    setBusy(true);
    const { error } = await submitSuggestion(suggestion);
    setBusy(false);
    if (error) toast.error(error);
  }

  return (
    <button
      type="button"
      disabled={busy}
      onPointerDown={stop}
      onClick={click}
      className={`flex items-start gap-1.5 rounded-full border px-3 py-1.5 text-left text-xs shadow-sm transition-colors ${
        taken
          ? "border-primary/40 bg-primary/10 text-muted-foreground"
          : "bg-card hover:bg-accent"
      }`}
    >
      {taken && <Check className="mt-0.5 size-3 shrink-0 text-primary" />}
      <span>{suggestion.text}</span>
    </button>
  );
}
