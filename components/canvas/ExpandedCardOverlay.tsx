"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Copy,
  MessageSquareText,
  RefreshCw,
  Square,
  Trash2,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useGraphStore } from "@/lib/store/graph-store";
import { useComposerStore } from "@/lib/store/composer-store";
import { useStopStream } from "@/lib/chat-client";
import { copyCard } from "@/lib/export/copy-card";
import { neighboursOf } from "@/lib/graph/neighbours";
import { modifierLabel } from "@/lib/shortcuts";
import { thinkingSummary } from "@/lib/providers/thinking";
import { webSearchSummary } from "@/lib/providers/web-search";
import { HighlightedResponse } from "@/components/highlights/HighlightedResponse";
import { CardAttachmentList } from "./CardAttachmentList";
import { InterruptedNotice } from "./InterruptedNotice";
import { contextLabel, useCardState } from "./useCardState";

const DIRECTIONS = {
  up: { icon: ArrowUp, label: "Parent card" },
  down: { icon: ArrowDown, label: "Child card" },
  left: { icon: ArrowLeft, label: "Previous branch" },
  right: { icon: ArrowRight, label: "Next branch" },
} as const;

// Labels sit outside the card's four edges so they cost the card no room. The
// siblings only get their own gutters once the viewport is wide enough to hold
// them; below that they fold into the row above the card.
function NeighbourLabel({
  direction,
  targetId,
  className,
}: {
  direction: keyof typeof DIRECTIONS;
  targetId: string | null;
  className?: string;
}) {
  const title = useGraphStore((s) =>
    targetId ? s.nodes[targetId]?.title : undefined,
  );
  const setExpandedNode = useGraphStore((s) => s.setExpandedNode);
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode);
  if (!targetId) return null;

  const { icon: Icon, label } = DIRECTIONS[direction];
  const text = title ?? "Untitled";
  return (
    <button
      type="button"
      title={`${label}: ${text}`}
      onClick={() => {
        setSelectedNode(targetId);
        setExpandedNode(targetId);
      }}
      className={cn(
        "pointer-events-auto flex max-w-full items-start gap-1.5 rounded-lg bg-popover/80 px-2 py-1 text-left text-xs font-medium text-foreground shadow-sm ring-1 ring-foreground/10 backdrop-blur-sm transition-colors hover:bg-popover hover:ring-foreground/25",
        className,
      )}
    >
      <Icon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
      <span className="line-clamp-2">{text}</span>
      <span className="sr-only">{label}</span>
    </button>
  );
}

export function ExpandedCardOverlay() {
  const expandedNodeId = useGraphStore((s) => s.expandedNodeId);
  const setExpandedNode = useGraphStore((s) => s.setExpandedNode);
  const nodes = useGraphStore((s) => s.nodes);
  const setDeletingNodes = useGraphStore((s) => s.setDeletingNodes);
  const openChat = useGraphStore((s) => s.openChat);
  const readOnly = useGraphStore((s) => s.readOnly);
  const setRegenerateNode = useComposerStore((s) => s.setRegenerateNode);
  const stopStream = useStopStream();
  const { node, responseText, contextCount, attachments, isError, isStreaming } =
    useCardState(expandedNodeId);

  const { parentId, childId, prevSiblingId, nextSiblingId } = useMemo(
    () => neighboursOf(Object.values(nodes), expandedNodeId),
    [nodes, expandedNodeId],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [expandedNodeId]);

  const promptRef = useRef<HTMLParagraphElement>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptClamped, setPromptClamped] = useState(false);
  const [lastExpandedId, setLastExpandedId] = useState(expandedNodeId);
  if (expandedNodeId !== lastExpandedId) {
    setLastExpandedId(expandedNodeId);
    setPromptOpen(false);
  }
  // Only measure while clamped: expanded, the paragraph always fits itself.
  useLayoutEffect(() => {
    const prompt = promptRef.current;
    if (!prompt || promptOpen) return;
    setPromptClamped(prompt.scrollHeight > prompt.clientHeight + 1);
  }, [node?.prompt, promptOpen]);

  const expandedNodeMissing = expandedNodeId !== null && !node;
  useEffect(() => {
    if (expandedNodeMissing) setExpandedNode(null);
  }, [expandedNodeMissing, setExpandedNode]);

  if (!node) return null;

  return (
    <Dialog
      open={expandedNodeId !== null}
      onOpenChange={(open) => {
        if (!open) setExpandedNode(null);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="pointer-events-none flex h-[92dvh] flex-col gap-0 overflow-visible bg-transparent p-0 ring-0 sm:max-w-4xl"
      >
        <div className="grid shrink-0 grid-cols-3 items-start gap-2 pb-1.5">
          <NeighbourLabel
            direction="left"
            targetId={prevSiblingId}
            className="col-start-1 justify-self-start xl:absolute xl:top-1/2 xl:right-full xl:mr-4 xl:w-40 xl:-translate-y-1/2"
          />
          <NeighbourLabel
            direction="up"
            targetId={parentId}
            className="col-start-2 justify-self-center"
          />
          <NeighbourLabel
            direction="right"
            targetId={nextSiblingId}
            className="col-start-3 justify-self-end xl:absolute xl:top-1/2 xl:left-full xl:ml-4 xl:w-40 xl:-translate-y-1/2"
          />
        </div>

        <div className="pointer-events-auto relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-popover ring-1 ring-foreground/10">
          <div className="flex items-start gap-2 border-b py-4 pr-3 pl-6">
            <DialogHeader className="min-w-0 flex-1">
              <DialogTitle>{node.title ?? "Untitled"}</DialogTitle>
              <DialogDescription
                ref={promptRef}
                className={
                  promptOpen
                    ? "max-h-56 overflow-y-auto whitespace-pre-wrap text-left"
                    : "line-clamp-3 whitespace-pre-wrap text-left"
                }
              >
                {node.prompt}
              </DialogDescription>
              {promptClamped && (
                <button
                  type="button"
                  onClick={() => setPromptOpen((open) => !open)}
                  className="w-fit text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  {promptOpen ? "Show less" : "Show more"}
                </button>
              )}
            </DialogHeader>
            <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
              {isStreaming && !readOnly && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Stop generating"
                  disabled={stopStream.isPending}
                  onClick={() => stopStream.mutate(node.id)}
                >
                  <Square />
                  <span className="sr-only">Stop generating</span>
                </Button>
              )}
              {!isStreaming && !readOnly && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Regenerate answer"
                  onClick={() => {
                    setRegenerateNode(node.id);
                    setExpandedNode(null);
                  }}
                >
                  <RefreshCw />
                  <span className="sr-only">Regenerate answer</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                title="Copy card"
                onClick={() => copyCard(node.id)}
              >
                <Copy />
                <span className="sr-only">Copy card</span>
              </Button>
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={`Open this thread as a chat (${modifierLabel()}I)`}
                  onClick={() => openChat(node.id)}
                >
                  <MessageSquareText />
                  <span className="sr-only">Open this thread as a chat</span>
                </Button>
              )}
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Delete card"
                  onClick={() => {
                    setDeletingNodes([node.id]);
                    setExpandedNode(null);
                  }}
                  className="hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 />
                  <span className="sr-only">Delete card</span>
                </Button>
              )}
              <DialogClose render={<Button variant="ghost" size="icon-sm" />}>
                <XIcon />
                <span className="sr-only">Close</span>
              </DialogClose>
            </div>
          </div>
          {attachments.length > 0 && (
            <div className="border-b px-6 py-3">
              <CardAttachmentList attachments={attachments} />
            </div>
          )}
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto px-6 py-4"
          >
            {responseText && (
              <HighlightedResponse
                nodeId={node.id}
                text={responseText}
                interactive={!readOnly && !isStreaming}
                className="prose prose-sm max-w-none dark:prose-invert"
              />
            )}
            {isError && (
              <InterruptedNotice
                nodeId={node.id}
                errorMessage={node.error_message}
              />
            )}
          </div>
          <div className="flex items-center gap-2 border-t px-6 py-2 text-xs text-muted-foreground">
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
            <span className="ml-auto">
              {new Date(node.created_at).toLocaleString()}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 justify-center pt-1.5">
          <NeighbourLabel
            direction="down"
            targetId={childId}
            className="max-w-[60%]"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
