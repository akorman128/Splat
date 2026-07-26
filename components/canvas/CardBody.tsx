"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, Maximize2 } from "lucide-react";
import { useGraphStore } from "@/lib/store/graph-store";
import { estimateTokens } from "@/lib/tokens";
import { SuggestionRail } from "./SuggestionRail";
import { InterruptedNotice } from "./InterruptedNotice";
import { contextLabel, useCardState } from "./useCardState";

// Renders one card's content, reading everything from application state by
// nodeId. Interactive children stop pointer propagation so clicks don't
// start a canvas drag; everything else drags/selects the card as normal.

const stop = (e: React.PointerEvent | React.WheelEvent) => e.stopPropagation();

export const CardBody = memo(function CardBody({ nodeId }: { nodeId: string }) {
  const { node, responseText, contextCount, isStreaming, isError } =
    useCardState(nodeId);
  const setExpandedNode = useGraphStore((s) => s.setExpandedNode);

  if (!node) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-xl border bg-card text-xs text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div
        className={`flex h-full w-full flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-md ${
          isError ? "border-destructive/60" : ""
        }`}
      >
        {/* Title */}
        <div className="flex items-center gap-2 border-b px-3 py-2">
          {isStreaming && (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          )}
          <span className="flex-1 truncate text-sm font-semibold">
            {node.title ?? (isStreaming ? "Thinking…" : "Untitled")}
          </span>
          <button
            type="button"
            title="Expand"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onPointerDown={stop}
            onClick={() => setExpandedNode(nodeId)}
          >
            <Maximize2 className="size-3.5" />
          </button>
        </div>

        {/* Prompt, collapsed to two lines */}
        <div className="border-b bg-muted/40 px-3 py-2">
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {node.prompt}
          </p>
        </div>

        {/* Response, scrollable */}
        <div
          className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
          onPointerDown={stop}
          onWheel={stop}
        >
          {responseText ? (
            <div className="prose prose-sm max-w-none dark:prose-invert prose-pre:overflow-x-auto prose-pre:text-xs">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {responseText}
              </ReactMarkdown>
            </div>
          ) : isStreaming ? (
            <p className="text-xs text-muted-foreground">Waiting for the first token…</p>
          ) : null}

          {isError && (
            <InterruptedNotice
              nodeId={nodeId}
              errorMessage={node.error_message}
              compact
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t px-3 py-1.5 text-[10px] text-muted-foreground">
          <span className="truncate">{node.model}</span>
          <span>·</span>
          <span>
            {node.prompt_tokens != null && node.completion_tokens != null
              ? `${node.prompt_tokens}→${node.completion_tokens} tok`
              : `~${estimateTokens(node.prompt + responseText)} tok`}
          </span>
          <span>·</span>
          <span>{contextLabel(contextCount)}</span>
          <span className="ml-auto">
            {new Date(node.created_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      </div>

      <SuggestionRail nodeId={nodeId} />
    </div>
  );
});
