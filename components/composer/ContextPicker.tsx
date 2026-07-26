"use client";

import { useMemo } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { useGraphStore } from "@/lib/store/graph-store";
import { ancestorsOf } from "@/lib/graph/ancestors";
import { topoOrder } from "@/lib/graph/topo-order";
import { estimateTokens } from "@/lib/tokens";
import type { NodeRow } from "@/lib/types";

// Context panel: every ancestor of the selected card (the parent-to-be),
// each with a checkbox and an approximate token count, plus a running total.
// Granularity is the whole card — prompt and response travel together.

export function ContextPicker({
  parent,
  checked,
  onToggle,
}: {
  parent: NodeRow;
  checked: Record<string, boolean>;
  onToggle: (nodeId: string, value: boolean) => void;
}) {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);

  const orderedAncestors = useMemo(() => {
    const all = Object.values(nodes);
    const ids = ancestorsOf(parent.id, all, edges);
    ids.add(parent.id);
    return topoOrder([...ids], all, edges);
  }, [parent.id, nodes, edges]);

  const totalTokens = orderedAncestors.reduce((sum, id) => {
    if (!checked[id]) return sum;
    const n = nodes[id];
    return sum + (n ? estimateTokens(n.prompt + n.response) : 0);
  }, 0);

  return (
    <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border bg-muted/30 p-2">
      <p className="px-1 pb-1 text-[11px] font-medium text-muted-foreground">
        Context — cards sent with this prompt
      </p>
      {orderedAncestors.map((id) => {
        const n = nodes[id];
        if (!n) return null;
        return (
          <label
            key={id}
            className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-accent/60"
          >
            <Checkbox
              checked={checked[id] ?? false}
              onCheckedChange={(value) => onToggle(id, value === true)}
            />
            <span className="flex-1 truncate">
              {n.title ?? n.prompt}
              {id === parent.id && (
                <span className="ml-1 text-muted-foreground">(parent)</span>
              )}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              ~{estimateTokens(n.prompt + n.response)} tok
            </span>
          </label>
        );
      })}
      <div className="flex justify-between border-t px-1 pt-1 text-[11px] font-medium">
        <span>Total</span>
        <span className="tabular-nums">~{totalTokens} tok</span>
      </div>
    </div>
  );
}
