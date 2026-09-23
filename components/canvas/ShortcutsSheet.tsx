"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ShortcutList } from "@/components/shortcut-list";

export function ShortcutsSheet({
  open,
  onOpenChange,
  readOnly = false,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  readOnly?: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-0">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>Keyboard shortcuts</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <ShortcutList readOnly={readOnly} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
