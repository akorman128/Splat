"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Highlighter } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useSettingsStore } from "@/lib/store/settings-store";
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_COLOR_LABELS,
  HIGHLIGHT_SWATCHES,
  type HighlightColor,
} from "@/lib/highlights/palette";

export function HighlightColorSetting({
  userId,
  initialColor,
}: {
  userId: string;
  initialColor: HighlightColor;
}) {
  const router = useRouter();
  const [color, setColor] = useState(initialColor);
  const [saving, setSaving] = useState(false);
  const setStoreColor = useSettingsStore((s) => s.setHighlightColor);

  async function save(next: HighlightColor) {
    if (next === color || saving) return;
    setColor(next);
    setStoreColor(next);
    setSaving(true);
    const { error } = await createClient()
      .from("profiles")
      .upsert({ id: userId, highlight_color: next });
    setSaving(false);
    if (error) {
      setColor(color);
      setStoreColor(color);
      toast.error("Could not save the highlight colour", {
        description: error.message,
      });
      return;
    }
    router.refresh();
  }

  return (
    <section className="space-y-1.5 rounded-lg border p-4">
      <p className="flex items-center gap-1.5 text-base font-medium">
        <Highlighter className="size-4 text-muted-foreground" />
        Highlight colour
      </p>
      <div className="flex flex-wrap gap-1">
        {HIGHLIGHT_COLORS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={option === color}
            disabled={saving}
            onClick={() => save(option)}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-accent",
              option === color
                ? "border-primary bg-primary/10 font-medium"
                : "border-input text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "size-3 rounded-full ring-1 ring-foreground/15",
                HIGHLIGHT_SWATCHES[option],
              )}
            />
            {HIGHLIGHT_COLOR_LABELS[option]}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        What colour new highlights are made in. Highlights you have already made
        keep the colour they were made in.
      </p>
    </section>
  );
}
