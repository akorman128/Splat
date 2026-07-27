"use client";

import { MOD, SHORTCUT_GROUPS, modifierLabel } from "@/lib/shortcuts";

export function ShortcutList({ modifier }: { modifier?: string }) {
  const mod = modifier ?? modifierLabel();

  return (
    <div className="space-y-6">
      {SHORTCUT_GROUPS.map((group) => (
        <section key={group.title} className="space-y-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {group.title}
          </h3>
          <ul className="space-y-1.5">
            {group.shortcuts.map((shortcut) => (
              <li
                key={shortcut.label}
                className="flex items-center justify-between gap-4"
              >
                <span className="text-sm text-foreground">
                  {shortcut.label}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {shortcut.keys.map((key) => (
                    <kbd
                      key={key}
                      className="inline-flex h-6 min-w-6 items-center justify-center rounded border bg-muted px-1.5 font-sans text-xs font-medium text-muted-foreground"
                    >
                      {key === MOD ? mod : key}
                    </kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
