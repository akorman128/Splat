"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useGraphStore } from "@/lib/store/graph-store";
import { useStreamStore } from "@/lib/store/stream-store";
import { retryChat } from "@/lib/chat-client";

// Expanded card view: an overlay layered above the canvas, NOT a resized
// tldraw shape. The canvas stays mounted underneath, so closing (Esc or X)
// is instant and the camera position is preserved.

export function ExpandedCardOverlay() {
  const expandedNodeId = useGraphStore((s) => s.expandedNodeId);
  const setExpandedNode = useGraphStore((s) => s.setExpandedNode);
  const node = useGraphStore((s) =>
    s.expandedNodeId ? s.nodes[s.expandedNodeId] : undefined,
  );
  const contextCount = useGraphStore((s) =>
    s.expandedNodeId
      ? s.edges.filter((e) => e.node_id === s.expandedNodeId).length
      : 0,
  );
  const streaming = useStreamStore((s) =>
    expandedNodeId ? s.streams[expandedNodeId] : undefined,
  );

  if (!node) return null;

  const responseText =
    node.status === "streaming" && streaming !== undefined
      ? streaming
      : node.response;

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
          {node.status === "error" && (
            <div className="mt-4 space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <p className="text-sm text-destructive">
                Generation was interrupted
                {node.error_message ? `: ${node.error_message}` : "."}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void retryChat(node.id)}
              >
                <RotateCcw className="size-3.5" /> Retry
              </Button>
            </div>
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
          <span>
            {contextCount === 0
              ? "no context"
              : `${contextCount} card${contextCount === 1 ? "" : "s"} in context`}
          </span>
          <span className="ml-auto">
            {new Date(node.created_at).toLocaleString()}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
