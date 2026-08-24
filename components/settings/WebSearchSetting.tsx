"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

export function WebSearchSetting({
  userId,
  initialOn,
}: {
  userId: string;
  initialOn: boolean;
}) {
  const router = useRouter();
  const [on, setOn] = useState(initialOn);
  const [saving, setSaving] = useState(false);

  async function save(next: boolean) {
    if (next === on || saving) return;
    setOn(next);
    setSaving(true);
    const { error } = await createClient()
      .from("profiles")
      .upsert({ id: userId, web_search: next });
    setSaving(false);
    if (error) {
      setOn(!next);
      toast.error("Could not save the web search setting", {
        description: error.message,
      });
      return;
    }
    router.refresh();
  }

  return (
    <section className="space-y-1.5 rounded-lg border p-4">
      <p className="flex items-center gap-1.5 text-base font-medium">
        <Globe className="size-4 text-muted-foreground" />
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
            aria-pressed={option.on === on}
            disabled={saving}
            onClick={() => save(option.on)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-accent",
              option.on === on
                ? "border-primary bg-primary/10 font-medium"
                : "border-input text-muted-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Whether new prompts start with web search on. Each prompt can still be
        flipped the other way in the model picker, and a model that cannot
        search never searches.
      </p>
    </section>
  );
}
