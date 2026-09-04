"use client";

import { useEffect } from "react";
import { useGraphStore } from "@/lib/store/graph-store";
import { useComposerStore } from "@/lib/store/composer-store";
import { firstRootId, neighboursOf, type Neighbours } from "@/lib/graph/neighbours";
import { copyCard } from "@/lib/export/copy-card";

const NAV_KEYS: Record<string, keyof Neighbours> = {
  ArrowUp: "parentId",
  ArrowDown: "childId",
  ArrowLeft: "prevSiblingId",
  ArrowRight: "nextSiblingId",
};

// Fields and popup lists drive the arrow keys themselves.
const KEEPS_ARROWS =
  'input, textarea, select, [contenteditable="true"], [role="listbox"], [role="menu"], [role="combobox"]';

function ownsArrowKeys(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest(KEEPS_ARROWS) !== null;
}

// The card under the pointer, falling back to the one already open or clicked.
function cardInFocus(graph: ReturnType<typeof useGraphStore.getState>) {
  const id = graph.expandedNodeId ?? graph.hoveredNodeId ?? graph.selectedNodeId;
  return id ? graph.nodes[id] : undefined;
}

export function useKeyboardShortcuts({
  shortcutsOpen,
  setShortcutsOpen,
  toggleComposer,
}: {
  shortcutsOpen: boolean;
  setShortcutsOpen(open: boolean): void;
  toggleComposer(): void;
}) {
  useEffect(() => {
    function handle(event: KeyboardEvent) {
      if (event.altKey) return;

      const graph = useGraphStore.getState();
      const claim = () => {
        event.preventDefault();
        event.stopPropagation();
      };

      if (event.metaKey || event.ctrlKey) {
        const key = event.key.toLowerCase();

        // Copy is the only shifted card shortcut; the sidebar owns the rest.
        if (event.shiftKey) {
          if (key !== "c") return;
          const target = cardInFocus(graph);
          if (!target) return;
          claim();
          copyCard(target.id);
          return;
        }

        if (key === "/") {
          claim();
          setShortcutsOpen(!shortcutsOpen);
          return;
        }
        if (key === "h") {
          claim();
          toggleComposer();
          return;
        }
        if (key !== "o" && key !== "r") return;

        const target = cardInFocus(graph);
        // With no card to act on, leave the key to the browser rather than
        // swallowing a reload nothing replaces.
        if (!target) return;
        claim();

        if (key === "o") {
          graph.setExpandedNode(target.id);
        } else if (target.status !== "streaming") {
          graph.setExpandedNode(null);
          useComposerStore.getState().setRegenerateNode(target.id);
        }
        return;
      }

      const field = NAV_KEYS[event.key];
      if (
        !field ||
        event.shiftKey ||
        event.metaKey ||
        event.ctrlKey ||
        shortcutsOpen ||
        graph.deletingNodeIds.length > 0 ||
        ownsArrowKeys(event.target)
      ) {
        return;
      }

      claim();
      const nodes = Object.values(graph.nodes);
      const from =
        graph.expandedNodeId ?? graph.selectedNodeId ?? graph.hoveredNodeId;
      const next = from ? neighboursOf(nodes, from)[field] : firstRootId(nodes);
      if (!next) return;

      graph.setSelectedNode(next);
      if (graph.expandedNodeId) graph.setExpandedNode(next);
    }

    window.addEventListener("keydown", handle, { capture: true });
    return () => window.removeEventListener("keydown", handle, { capture: true });
  }, [shortcutsOpen, setShortcutsOpen, toggleComposer]);
}
