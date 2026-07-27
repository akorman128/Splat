"use client";

import { useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useGraphStore } from "@/lib/store/graph-store";
import { InterruptedNotice } from "./InterruptedNotice";
import { contextLabel, useCardState } from "./useCardState";

// Expanded card view: an overlay layered above the canvas, NOT a resized
// tldraw shape. The canvas stays mounted underneath, so closing (Esc or X)
// is instant and the camera position is preserved.

export function ExpandedCardOverlay() {
  const expandedNodeId = useGraphStore((s) => s.expandedNodeId);
  const setExpandedNode = useGraphStore((s) => s.setExpandedNode);
  const { node, responseText, contextCount, isError } =
    useCardState(expandedNodeId);

  // The Dialog's onOpenChange is the only thing that clears expandedNodeId, so
  // returning null while the id is still set left the app wedged: Esc and the
  // ✕ button did not exist, and clicking Expand on that card was a no-op
  // because setExpandedNode would write the id the store already held. If the
  // node has left the store (conversation switch, re-init), drop the id.
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
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{node.title ?? "Untitled"}</DialogTitle>
          <DialogDescription className="whitespace-pre-wrap text-left">
            {node.prompt}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
