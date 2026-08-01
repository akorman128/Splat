import { Loader2 } from "lucide-react";

// Held back briefly so a fast load never flashes it.
export function CanvasSpinner() {
  return (
    <div className="absolute inset-0 flex items-center justify-center animate-in fade-in delay-150 duration-300 fill-mode-both">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
      <span className="sr-only">Loading conversation…</span>
    </div>
  );
}
