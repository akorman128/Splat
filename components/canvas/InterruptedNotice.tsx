"use client";

import { toast } from "sonner";
import { Loader2, RotateCcw } from "lucide-react";
import { useChatStream } from "@/lib/chat-client";
import { useGraphStore } from "@/lib/store/graph-store";

export function InterruptedNotice({
  nodeId,
  errorMessage,
  compact = false,
}: {
  nodeId: string;
  errorMessage: string | null;
  compact?: boolean;
}) {
  const chat = useChatStream();
  const readOnly = useGraphStore((s) => s.readOnly);
  const retrying = chat.isPending;

  function retry() {
    if (retrying) return;
    chat.mutate(
      { request: { retryNodeId: nodeId } },
      { onError: (error) => toast.error(error.message) },
    );
  }

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
      {!readOnly && (
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
      )}
    </div>
  );
}
