"use client";

import { useEffect } from "react";
import { useGraphStore } from "@/lib/store/graph-store";
import { useComposerStore } from "@/lib/store/composer-store";
import { firstRootId, neighboursOf, type Neighbours } from "@/lib/graph/neighbours";

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

export function useKeyboardShortcuts({
  shortcutsOpen,
  setShortcutsOpen,
  toggleComposer,
  chatOpen,
  toggleChat,
}: {
  shortcutsOpen: boolean;
  setShortcutsOpen(open: boolean): void;
  toggleComposer(): void;
  chatOpen: boolean;
  toggleChat(): void;
}) {
  useEffect(() => {
    function handle(event: KeyboardEvent) {
      if (event.altKey) return;

      const graph = useGraphStore.getState();
      const claim = () => {
        event.preventDefault();
        event.stopPropagation();
      };

      if ((event.metaKey || event.ctrlKey) && !event.shiftKey) {
        const key = event.key.toLowerCase();
        if (key === "/") {
          claim();
          setShortcutsOpen(!shortcutsOpen);
          return;
        }
        if (key === "i") {
          claim();
          toggleChat();
          return;
        }
        if (key === "h") {
          claim();
          if (!chatOpen) toggleComposer();
          return;
        }
        if (key !== "o" && key !== "r") return;
        // The chat view already is the opened card, and it regenerates the
        // message holding focus rather than whatever the canvas has selected.
        if (chatOpen) {
          if (key === "o") claim();
          return;
        }

        const targetId =
          graph.expandedNodeId ?? graph.hoveredNodeId ?? graph.selectedNodeId;
        const target = targetId ? graph.nodes[targetId] : undefined;
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
        chatOpen ||
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
  }, [shortcutsOpen, setShortcutsOpen, toggleComposer, chatOpen, toggleChat]);
}
