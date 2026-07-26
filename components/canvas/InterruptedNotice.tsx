"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, RotateCcw } from "lucide-react";
import { retryChat } from "@/lib/chat-client";

// The "generation was interrupted" panel and its Retry button, shared by the
// canvas card and the expanded overlay.

/**
 * Retry is guarded while in flight. The server claims the node with a
 * compare-and-swap and 409s the loser, so a double-click can no longer
 * interleave two streams onto one row — but the second request was still
 * wasted, and because the result was discarded (`void retryChat(...)`) the
 * user saw nothing at all when a retry failed for a real reason (no API key,
 * undecryptable key). Disable while running and surface the error.
 */
export function InterruptedNotice({
  nodeId,
  errorMessage,
  compact = false,
}: {
  nodeId: string;
  errorMessage: string | null;
  compact?: boolean;
}) {
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    if (retrying) return;
    setRetrying(true);
    try {
      const { error } = await retryChat(nodeId);
      if (error) toast.error(error);
    } finally {
      setRetrying(false);
    }
  }

  // On the canvas, swallow the pointer so clicking Retry doesn't start a
  // card drag. In the dialog there is no canvas underneath.
  const stopPointer = compact
    ? (e: React.PointerEvent) => e.stopPropagation()
    : undefined;

  return (
    <div
      className={
        compact
          ? "mt-2 space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-2"
          : "mt-4 space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3"
      }
    >
      <p
        className={
          compact ? "text-xs text-destructive" : "text-sm text-destructive"
        }
      >
        Generation was interrupted
        {errorMessage ? `: ${errorMessage}` : "."}
      </p>
      <button
        type="button"
        disabled={retrying}
        onPointerDown={stopPointer}
        onClick={retry}
        className={`inline-flex items-center gap-1 rounded-md border font-medium hover:bg-accent disabled:opacity-60 ${
          compact ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"
        }`}
      >
        {retrying ? (
          <Loader2 className={compact ? "size-3 animate-spin" : "size-3.5 animate-spin"} />
        ) : (
          <RotateCcw className={compact ? "size-3" : "size-3.5"} />
        )}
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
