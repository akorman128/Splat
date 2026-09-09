"use client";

import { Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  THINKING_LABELS,
  THINKING_LEVELS,
  isThinkingLevel,
  type ThinkingLevel,
} from "@/lib/providers/thinking";

// Auto is the absence of a level rather than one of them, so it needs a value
// of its own to sit in a radio group.
const AUTO = "auto";

export function ThinkingMenu({
  value,
  onChange,
  className,
}: {
  value: ThinkingLevel | null;
  onChange: (level: ThinkingLevel | null) => void;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            title="How hard the model thinks before it answers"
            className={cn(
              "font-normal",
              value ? "text-foreground" : "text-muted-foreground",
              className,
            )}
          />
        }
      >
        <Brain />
        {value ? THINKING_LABELS[value] : "Auto"}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-40">
        <DropdownMenuRadioGroup
          value={value ?? AUTO}
          onValueChange={(next) =>
            onChange(isThinkingLevel(next) ? next : null)
          }
        >
          {/* base-ui keeps a radio item's menu open by default. */}
          <DropdownMenuRadioItem value={AUTO} closeOnClick>
            Auto
          </DropdownMenuRadioItem>
          {THINKING_LEVELS.map((level) => (
            <DropdownMenuRadioItem key={level} value={level} closeOnClick>
              {THINKING_LABELS[level]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
