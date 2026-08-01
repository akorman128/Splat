"use client";

import { useMemo, useState } from "react";
import { List, Loader2, TriangleAlert, X } from "lucide-react";
import { useGraphStore } from "@/lib/store/graph-store";
import { outlineOrder } from "@/lib/graph/outline";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const HIDE_LABEL = "Hide the card list";
const SHOW_LABEL = "Show the card list";

export function CardOutline() {
  const nodes = useGraphStore((s) => s.nodes);
  const [open, setOpen] = useState(true);

  const entries = useMemo(() => outlineOrder(Object.values(nodes)), [nodes]);
  if (entries.length === 0) return null;

  return (
    <div className="pointer-events-none absolute right-2 top-2 z-40 hidden justify-end md:flex">
      {open ? (
        <div className="pointer-events-auto flex max-h-[min(60vh,26rem)] w-64 flex-col overflow-hidden rounded-lg border bg-popover/90 opacity-35 shadow-lg backdrop-blur-sm transition-opacity duration-150 hover:opacity-100 focus-within:opacity-100">
          <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
            <span className="flex-1 truncate text-xs font-medium text-muted-foreground">
              {entries.length} card{entries.length === 1 ? "" : "s"}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              title={HIDE_LABEL}
              onClick={() => setOpen(false)}
            >
              <X />
              <span className="sr-only">{HIDE_LABEL}</span>
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {entries.map(({ id, depth }) => (
              <OutlineRow key={id} nodeId={id} depth={depth} />
            ))}
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          size="icon-sm"
          title={SHOW_LABEL}
          onClick={() => setOpen(true)}
          className="pointer-events-auto opacity-35 shadow-lg transition-opacity duration-150 hover:opacity-100"
        >
          <List />
          <span className="sr-only">{SHOW_LABEL}</span>
        </Button>
      )}
    </div>
  );
}

function OutlineRow({ nodeId, depth }: { nodeId: string; depth: number }) {
  const node = useGraphStore((s) => s.nodes[nodeId]);
  const isSelected = useGraphStore((s) => s.selectedNodeId === nodeId);
  const setFocusNode = useGraphStore((s) => s.setFocusNode);

  if (!node) return null;

  const isStreaming = node.status === "streaming";
  const title = node.title ?? (isStreaming ? "Thinking…" : "Untitled");

  return (
    <button
      type="button"
      title={node.prompt}
      onClick={() => setFocusNode(nodeId)}
      style={{ paddingInlineStart: 8 + depth * 12 }}
      className={cn(
        "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-accent hover:text-foreground",
        isSelected ? "bg-accent text-foreground" : "text-muted-foreground",
      )}
    >
      {isStreaming && <Loader2 className="size-3 shrink-0 animate-spin" />}
      {node.status === "error" && (
        <TriangleAlert className="size-3 shrink-0 text-destructive" />
      )}
      <span className="truncate">{title}</span>
    </button>
  );
}
