"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, Maximize2, RefreshCw, Trash2 } from "lucide-react";
import { useGraphStore } from "@/lib/store/graph-store";
import { useComposerStore } from "@/lib/store/composer-store";
import { estimateTokens } from "@/lib/tokens";
import { thinkingSummary } from "@/lib/providers/thinking";
import { webSearchSummary } from "@/lib/providers/web-search";
import { AttachmentIcon } from "@/components/attachments/AttachmentIcon";
import { SuggestionRail } from "./SuggestionRail";
import { InterruptedNotice } from "./InterruptedNotice";
import { contextLabel, useCardState } from "./useCardState";

const stop = (e: React.PointerEvent) => e.stopPropagation();

// tldraw reads wheel events off a native listener on the canvas, so React's
// stopPropagation lands too late to stop the camera panning over the card.
const keepScrollLocal = (element: HTMLDivElement | null) => {
  if (!element) return;
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) return;
    if (element.scrollHeight > element.clientHeight) event.stopPropagation();
  };
  element.addEventListener("wheel", onWheel);
  return () => element.removeEventListener("wheel", onWheel);
};

export const CardBody = memo(function CardBody({ nodeId }: { nodeId: string }) {
  const { node, responseText, contextCount, attachments, isStreaming, isError } =
    useCardState(nodeId);
  const setExpandedNode = useGraphStore((s) => s.setExpandedNode);
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode);
  const setHoveredNode = useGraphStore((s) => s.setHoveredNode);
  const setDeletingNodes = useGraphStore((s) => s.setDeletingNodes);
  const readOnly = useGraphStore((s) => s.readOnly);
  const setRegenerateNode = useComposerStore((s) => s.setRegenerateNode);
  const isRegenerateTarget = useComposerStore(
    (s) => s.regenerateNodeId === nodeId,
  );

  if (!node) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-xl border bg-card text-xs text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div
      className="relative h-full w-full"
      onPointerEnter={() => setHoveredNode(nodeId)}
      onPointerLeave={() => setHoveredNode(null)}
    >
      <div
        className={`flex h-full w-full flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-md ${
          isError ? "border-destructive/60" : ""
        } ${isRegenerateTarget ? "ring-2 ring-primary" : ""}`}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2">
          {isStreaming && (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          )}
          <span className="flex-1 truncate text-lg font-semibold">
            {node.title ?? (isStreaming ? "Thinking…" : "Untitled")}
          </span>
          {!isStreaming && !readOnly && (
            <button
              type="button"
              title={
                isRegenerateTarget ? "Cancel regeneration" : "Regenerate answer"
              }
              className={`rounded p-1 ${
                isRegenerateTarget
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
              onPointerDown={stop}
              onClick={() =>
                setRegenerateNode(isRegenerateTarget ? null : nodeId)
              }
            >
              <RefreshCw className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            title="Expand"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onPointerDown={stop}
            onClick={() => setExpandedNode(nodeId)}
          >
            <Maximize2 className="size-3.5" />
          </button>
          {!readOnly && (
            <button
              type="button"
              title="Delete card"
              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onPointerDown={stop}
              onClick={() => setDeletingNodes([nodeId])}
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>

        <div className="border-b bg-muted/40 px-3 py-2">
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {node.prompt}
          </p>
        </div>

        {attachments.length > 0 && (
          // The chips are buttons, so the card must not read the pointer as the
          // start of a drag — without this, clicking one flings the card.
          <div
            className="flex flex-wrap gap-1 border-b bg-muted/20 px-3 py-1.5"
            onPointerDown={stop}
          >
            {attachments.map((attachment) => (
              <button
                key={attachment.id}
                type="button"
                title={`${attachment.filename} — open the card to see it`}
                onClick={() => setExpandedNode(nodeId)}
                className="flex max-w-40 items-center gap-1 rounded border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <AttachmentIcon
                  kind={attachment.kind}
                  className="size-2.5 shrink-0"
                />
                <span className="truncate">{attachment.filename}</span>
              </button>
            ))}
          </div>
        )}

        <div
          ref={keepScrollLocal}
          className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
          onPointerDown={(e) => {
            stop(e);
            setSelectedNode(nodeId);
          }}
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

        <div className="flex items-center gap-2 border-t px-3 py-1.5 text-[10px] text-muted-foreground">
          <span className="truncate">{node.model}</span>
          {thinkingSummary(node.thinking_level) && (
            <>
              <span>·</span>
              <span className="truncate">
                {thinkingSummary(node.thinking_level)}
              </span>
            </>
          )}
          {webSearchSummary(node.web_search) && (
            <>
              <span>·</span>
              <span className="truncate">
                {webSearchSummary(node.web_search)}
              </span>
            </>
          )}
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
