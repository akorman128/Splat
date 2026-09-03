"use client";

import { toast } from "sonner";
import { Check } from "lucide-react";
import { useGraphStore } from "@/lib/store/graph-store";
import { useSubmitSuggestion } from "@/lib/chat-actions";
import type { SuggestionRow } from "@/lib/types";

const stop = (e: React.PointerEvent) => e.stopPropagation();

export function SuggestionRail({ nodeId }: { nodeId: string }) {
  const suggestions = useGraphStore((s) => s.suggestions[nodeId]);
  const status = useGraphStore((s) => s.nodes[nodeId]?.status);
  const readOnly = useGraphStore((s) => s.readOnly);

  if (!suggestions || suggestions.length === 0 || status !== "complete") {
    return null;
  }
  if (readOnly) return null;

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
  const submit = useSubmitSuggestion();
  const taken = suggestion.taken_at !== null;

  function click() {
    if (taken || submit.isPending) return;
    submit.mutate(suggestion, {
      onError: (error) => toast.error(error.message),
    });
  }

  return (
    <button
      type="button"
      disabled={submit.isPending}
      onPointerDown={stop}
      onClick={click}
      className={`flex items-start gap-1.5 rounded-full border px-3 py-1.5 text-left text-xs shadow-sm transition-colors ${
        taken
          ? "border-primary/40 bg-primary/10 text-muted-foreground"
          : "bg-card hover:bg-accent"
      }`}
    >
      {taken && <>✅</>}
      <span>{suggestion.text}</span>
    </button>
  );
}
