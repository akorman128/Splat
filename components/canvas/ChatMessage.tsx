"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Loader2,
  RefreshCw,
  Square,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGraphStore } from "@/lib/store/graph-store";
import { useComposerStore } from "@/lib/store/composer-store";
import { useStopStream } from "@/lib/chat-client";
import { thinkingSummary } from "@/lib/providers/thinking";
import { webSearchSummary } from "@/lib/providers/web-search";
import { CardAttachmentList } from "./CardAttachmentList";
import { InterruptedNotice } from "./InterruptedNotice";
import { contextLabel, useCardState } from "./useCardState";

const pillClass =
  "inline-flex items-center gap-1 rounded-md border px-2 py-1 font-medium hover:bg-accent hover:text-foreground disabled:opacity-50";

export const ChatMessage = memo(function ChatMessage({
  nodeId,
  focused,
  branchIndex,
  branchCount,
  prevBranchId,
  nextBranchId,
  onFocus,
  onSwitchBranch,
  onShowOnCanvas,
}: {
  nodeId: string;
  focused: boolean;
  // Passed in rather than derived here: reading the node map would subscribe
  // every message to every card's updates.
  branchIndex: number;
  branchCount: number;
  prevBranchId: string | null;
  nextBranchId: string | null;
  onFocus: (nodeId: string) => void;
  onSwitchBranch: (nodeId: string) => void;
  onShowOnCanvas: (nodeId: string) => void;
}) {
  const { node, responseText, contextCount, attachments, isStreaming, isError } =
    useCardState(nodeId);
  const readOnly = useGraphStore((s) => s.readOnly);
  const setDeletingNodes = useGraphStore((s) => s.setDeletingNodes);
  const setRegenerateNode = useComposerStore((s) => s.setRegenerateNode);
  const stopStream = useStopStream();

  if (!node) return null;

  return (
    <div
      data-message-id={nodeId}
      onPointerDown={() => onFocus(nodeId)}
      className={cn(
        "space-y-3 border-l-2 pl-4 transition-colors",
        focused ? "border-primary/40" : "border-transparent",
      )}
    >
      <div className="flex flex-col items-end gap-1.5">
        <span className="max-w-[85%] truncate text-[11px] font-medium text-muted-foreground">
          {node.title ?? (isStreaming ? "Thinking…" : "Untitled")}
        </span>
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5">
          <p className="text-sm whitespace-pre-wrap">{node.prompt}</p>
        </div>
        {attachments.length > 0 && (
          <div className="w-full sm:max-w-[85%]">
            <CardAttachmentList attachments={attachments} />
          </div>
        )}
      </div>

      <div className="space-y-2">
        {responseText ? (
          <div className="prose prose-sm max-w-none dark:prose-invert prose-pre:overflow-x-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {responseText}
            </ReactMarkdown>
          </div>
        ) : isStreaming ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Waiting for the first token…
          </p>
        ) : null}

        {isError && (
          <InterruptedNotice nodeId={node.id} errorMessage={node.error_message} />
        )}

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {branchCount > 1 && (
            <span className="mr-1 inline-flex items-center gap-0.5">
              <button
                type="button"
                title="Previous branch (←)"
                disabled={!prevBranchId}
                onClick={() => prevBranchId && onSwitchBranch(prevBranchId)}
                className="rounded p-0.5 hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <ChevronLeft className="size-3.5" />
                <span className="sr-only">Previous branch</span>
              </button>
              <span className="tabular-nums">
                {branchIndex + 1}/{branchCount}
              </span>
              <button
                type="button"
                title="Next branch (→)"
                disabled={!nextBranchId}
                onClick={() => nextBranchId && onSwitchBranch(nextBranchId)}
                className="rounded p-0.5 hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <ChevronRight className="size-3.5" />
                <span className="sr-only">Next branch</span>
              </button>
            </span>
          )}
          <span>{node.model}</span>
          {thinkingSummary(node.thinking_level) && (
            <>
              <span>·</span>
              <span>{thinkingSummary(node.thinking_level)}</span>
            </>
          )}
          {webSearchSummary(node.web_search) && (
            <>
              <span>·</span>
              <span>{webSearchSummary(node.web_search)}</span>
            </>
          )}
          <span>·</span>
          <span>
            {node.prompt_tokens != null && node.completion_tokens != null
              ? `${node.prompt_tokens} prompt / ${node.completion_tokens} completion tokens`
              : "token counts pending"}
          </span>
          <span>·</span>
          <span>{contextLabel(contextCount)}</span>
          <span>·</span>
          <span>{new Date(node.created_at).toLocaleString()}</span>
          <span className="ml-auto inline-flex items-center gap-1.5">
            <button
              type="button"
              title="Show this card on the canvas"
              onClick={() => onShowOnCanvas(node.id)}
              className={pillClass}
            >
              <Crosshair className="size-3" />
              <span className="sr-only">Show this card on the canvas</span>
            </button>
            {isStreaming && !readOnly && (
              <button
                type="button"
                disabled={stopStream.isPending}
                onClick={() => stopStream.mutate(node.id)}
                className={pillClass}
              >
                <Square className="size-3" />
                Stop
              </button>
            )}
            {!isStreaming && !readOnly && (
              <button
                type="button"
                onClick={() => setRegenerateNode(node.id)}
                className={pillClass}
              >
                <RefreshCw className="size-3" />
                Regenerate
              </button>
            )}
            {!readOnly && (
              <button
                type="button"
                onClick={() => setDeletingNodes([node.id])}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 font-medium text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-3" />
                Delete
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
});
