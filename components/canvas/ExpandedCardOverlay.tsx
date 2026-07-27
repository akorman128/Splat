"use client";

import { useEffect, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useGraphStore } from "@/lib/store/graph-store";
import { useComposerStore } from "@/lib/store/composer-store";
import type { NodeRow } from "@/lib/types";
import { InterruptedNotice } from "./InterruptedNotice";
import { contextLabel, useCardState } from "./useCardState";

const byCreation = (a: NodeRow, b: NodeRow) =>
  a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

const NO_NEIGHBOURS = {
  parentId: null,
  childId: null,
  prevSiblingId: null,
  nextSiblingId: null,
};

// Up/down walk the parent_id lineage the canvas draws as solid arrows. A node
// can have several children, so down enters the oldest branch and left/right
// swap between branches at the current depth.
function neighboursOf(nodes: Record<string, NodeRow>, id: string | null) {
  const current = id ? nodes[id] : undefined;
  if (!current) return NO_NEIGHBOURS;

  const all = Object.values(nodes);
  const siblings = all
    .filter((n) => n.parent_id === current.parent_id)
    .sort(byCreation);
  const children = all
    .filter((n) => n.parent_id === current.id)
    .sort(byCreation);
  const i = siblings.findIndex((n) => n.id === current.id);

  return {
    parentId: current.parent_id,
    childId: children[0]?.id ?? null,
    prevSiblingId: i > 0 ? siblings[i - 1].id : null,
    nextSiblingId: siblings[i + 1]?.id ?? null,
  };
}

function NavButton({
  label,
  targetId,
  children,
}: {
  label: string;
  targetId: string | null;
  children: React.ReactNode;
}) {
  const setExpandedNode = useGraphStore((s) => s.setExpandedNode);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title={label}
      disabled={!targetId}
      onClick={() => targetId && setExpandedNode(targetId)}
    >
      {children}
      <span className="sr-only">{label}</span>
    </Button>
  );
}

export function ExpandedCardOverlay() {
  const expandedNodeId = useGraphStore((s) => s.expandedNodeId);
  const setExpandedNode = useGraphStore((s) => s.setExpandedNode);
  const nodes = useGraphStore((s) => s.nodes);
  const setDeletingNodes = useGraphStore((s) => s.setDeletingNodes);
  const setRegenerateNode = useComposerStore((s) => s.setRegenerateNode);
  const { node, responseText, contextCount, isError, isStreaming } =
    useCardState(expandedNodeId);

  const { parentId, childId, prevSiblingId, nextSiblingId } = useMemo(
    () => neighboursOf(nodes, expandedNodeId),
    [nodes, expandedNodeId],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [expandedNodeId]);

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
      <DialogContent className="flex h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <div className="absolute top-2 right-10 z-10 flex items-center gap-1">
          <NavButton label="Previous branch" targetId={prevSiblingId}>
            <ChevronLeft />
          </NavButton>
          <NavButton label="Parent card" targetId={parentId}>
            <ChevronUp />
          </NavButton>
          <NavButton label="Child card" targetId={childId}>
            <ChevronDown />
          </NavButton>
          <NavButton label="Next branch" targetId={nextSiblingId}>
            <ChevronRight />
          </NavButton>
        </div>
        <DialogHeader className="border-b py-4 pr-44 pl-6">
          <DialogTitle>{node.title ?? "Untitled"}</DialogTitle>
          <DialogDescription className="whitespace-pre-wrap text-left">
            {node.prompt}
          </DialogDescription>
        </DialogHeader>
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto px-6 py-4"
        >
          {responseText && (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {responseText}
              </ReactMarkdown>
            </div>
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
          {!isStreaming && (
            <button
              type="button"
              onClick={() => {
                setRegenerateNode(node.id);
                setExpandedNode(null);
              }}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 font-medium hover:bg-accent hover:text-foreground"
            >
              <RefreshCw className="size-3" />
              Regenerate
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setDeletingNodes([node.id]);
              setExpandedNode(null);
            }}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 font-medium text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="size-3" />
            Delete
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
