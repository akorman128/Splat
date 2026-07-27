"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SkillSummary } from "@/lib/types";

// A "/" run in the prompt, immediately before the caret and at a word boundary.
const TRIGGER = /(?:^|\s)\/([^\s/]*)$/;

export type SkillTrigger = { query: string; from: number; to: number };

export function skillTriggerAt(
  value: string,
  caret: number,
): SkillTrigger | null {
  const match = TRIGGER.exec(value.slice(0, caret));
  if (!match) return null;
  const query = match[1];
  return { query, from: caret - query.length - 1, to: caret };
}

export function matchSkills(
  skills: SkillSummary[],
  query: string,
  attachedIds: string[],
  limit = 6,
): SkillSummary[] {
  const q = query.toLowerCase();
  return skills
    .filter((s) => !attachedIds.includes(s.id))
    .filter((s) => s.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const rank = (name: string) =>
        name.toLowerCase().startsWith(q) ? 0 : 1;
      return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}

export function SkillMenu({
  matches,
  highlight,
  onHighlight,
  onPick,
}: {
  matches: SkillSummary[];
  highlight: number;
  onHighlight: (index: number) => void;
  onPick: (skill: SkillSummary) => void;
}) {
  return (
    <div
      role="listbox"
      aria-label="Skills"
      className="absolute bottom-full left-0 z-50 mb-1 w-64 overflow-hidden rounded-lg border bg-popover p-1 shadow-lg"
    >
      {matches.map((skill, index) => (
        <button
          key={skill.id}
          type="button"
          role="option"
          aria-selected={index === highlight}
          onMouseEnter={() => onHighlight(index)}
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(skill);
          }}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
            index === highlight && "bg-accent text-accent-foreground",
          )}
        >
          <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{skill.name}</span>
        </button>
      ))}
    </div>
  );
}
