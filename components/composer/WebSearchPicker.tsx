"use client";

import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";

export function WebSearchPicker({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (webSearch: boolean) => void;
}) {
  return (
    <div className="space-y-1.5 border-t pt-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Globe className="size-3.5 text-muted-foreground" />
        Web search
      </p>
      <div className="flex flex-wrap gap-1">
        {[
          { on: false, label: "Off" },
          { on: true, label: "On" },
        ].map((option) => (
          <button
            key={option.label}
            type="button"
            aria-pressed={option.on === value}
            onClick={() => onChange(option.on)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-accent",
              option.on === value
                ? "border-primary bg-primary/10 font-medium"
                : "border-input text-muted-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Lets the model search when it decides it needs to — no second key, but
        the searches and the pages they pull in are billed to the same account.
        Cited sources are listed under the answer. Models that cannot search
        don&rsquo;t show this. New prompts start on the side Settings picks.
      </p>
    </div>
  );
}
