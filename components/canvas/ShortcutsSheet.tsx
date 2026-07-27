"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ShortcutList } from "@/components/shortcut-list";
import { SHORTCUTS_HINT } from "@/lib/shortcuts";

export function ShortcutsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-0">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>Keyboard shortcuts</SheetTitle>
          <SheetDescription>{SHORTCUTS_HINT}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <ShortcutList />
        </div>
      </SheetContent>
    </Sheet>
  );
}
