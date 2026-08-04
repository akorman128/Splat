"use client";

import { Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  THINKING_LABELS,
  THINKING_LEVELS,
  type ThinkingLevel,
} from "@/lib/providers/thinking";

// Null leads, because it is the default rather than the absence of one.
const OPTIONS: { level: ThinkingLevel | null; label: string }[] = [
  { level: null, label: "Auto" },
  ...THINKING_LEVELS.map((level) => ({ level, label: THINKING_LABELS[level] })),
];

// Lives inside the model dialog rather than beside it: the two are one choice
// on the composer's only crowded row, and a sixth control there wraps the row
// off the screen on a phone.
export function ThinkingPicker({
  value,
  onChange,
}: {
  value: ThinkingLevel | null;
  onChange: (level: ThinkingLevel | null) => void;
}) {
  return (
    <div className="space-y-1.5 border-t pt-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Brain className="size-3.5 text-muted-foreground" />
        Thinking
      </p>
      <div className="flex flex-wrap gap-1">
        {OPTIONS.map((option) => {
          const selected = option.level === value;
          return (
            <button
              key={option.label}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.level)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-accent",
                selected
                  ? "border-primary bg-primary/10 font-medium"
                  : "border-input text-muted-foreground",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Auto asks for no level at all and lets the model decide — the only
        setting every model accepts. The rest are a 400 on a model that cannot
        reason.
      </p>
    </div>
  );
}
