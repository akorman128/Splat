"use client";

import { create } from "zustand";
import type {
  CardAttachment,
  CardNode,
  ContextEdgeRow,
  SuggestionRow,
} from "@/lib/types";

type GraphState = {
  conversationId: string | null;
  // True only between a conversation being adopted and the route catching up, so
  // the draft route can tell cards it owns from the ones it was opened over.
  adopted: boolean;
  readOnly: boolean;
  nodes: Record<string, CardNode>;
  edges: ContextEdgeRow[];
  contextCounts: Record<string, number>;
  suggestions: Record<string, SuggestionRow[]>;
  // Keyed by the card that owns the file, not by every card that replays it.
  attachments: Record<string, CardAttachment[]>;
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  expandedNodeId: string | null;
  deletingNodeIds: string[];
  focusNodeId: string | null;
  // Deleted ids are kept so a stream still in flight cannot re-add its card.
  removedNodeIds: Record<string, true>;

  init(payload: {
    conversationId: string | null;
    nodes: CardNode[];
    edges: ContextEdgeRow[];
    suggestions: SuggestionRow[];
    attachments: CardAttachment[];
    readOnly?: boolean;
  }): void;
  adoptConversation(id: string): void;
  upsertNode(node: CardNode): void;
  addEdges(edges: ContextEdgeRow[]): void;
  addAttachments(attachments: CardAttachment[]): void;
  setSuggestions(nodeId: string, rows: SuggestionRow[]): void;
  markSuggestionTaken(suggestionId: string, takenAt: string): void;
  setSelectedNode(id: string | null): void;
  setHoveredNode(id: string | null): void;
  setExpandedNode(id: string | null): void;
  setFocusNode(id: string | null): void;
  setDeletingNodes(ids: string[]): void;
  removeNodes(ids: string[]): void;
  updateNodeGeometry(
    id: string,
    geometry: { x: number; y: number; w: number; h: number },
  ): void;
};

function countByConsumer(edges: ContextEdgeRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of edges) {
    counts[e.node_id] = (counts[e.node_id] ?? 0) + 1;
  }
  return counts;
}

function groupByOwner(
  attachments: CardAttachment[],
): Record<string, CardAttachment[]> {
  const grouped: Record<string, CardAttachment[]> = {};
  for (const a of attachments) {
    if (!a.node_id) continue;
    (grouped[a.node_id] ??= []).push(a);
  }
  for (const list of Object.values(grouped)) {
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  return grouped;
}

export const useGraphStore = create<GraphState>((set) => ({
  conversationId: null,
  adopted: false,
  readOnly: false,
  nodes: {},
  edges: [],
  contextCounts: {},
  suggestions: {},
  attachments: {},
  selectedNodeId: null,
  hoveredNodeId: null,
  expandedNodeId: null,
  deletingNodeIds: [],
  focusNodeId: null,
  removedNodeIds: {},

  init({
    conversationId,
    nodes,
    edges,
    suggestions,
    attachments,
    readOnly = false,
  }) {
    const suggestionMap: Record<string, SuggestionRow[]> = {};
    for (const s of suggestions) {
      (suggestionMap[s.node_id] ??= []).push(s);
    }
    for (const list of Object.values(suggestionMap)) {
      list.sort((a, b) => a.position - b.position);
    }
    set({
      conversationId,
      adopted: false,
      readOnly,
      nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
      edges,
      contextCounts: countByConsumer(edges),
      suggestions: suggestionMap,
      attachments: groupByOwner(attachments),
      selectedNodeId: null,
      hoveredNodeId: null,
      expandedNodeId: null,
      deletingNodeIds: [],
      focusNodeId: null,
      removedNodeIds: {},
    });
  },

  adoptConversation(id) {
    set((state) =>
      state.conversationId ? state : { conversationId: id, adopted: true },
    );
  },

  upsertNode(node) {
    set((state) => {
      if (state.conversationId !== node.conversation_id) return state;
      if (state.removedNodeIds[node.id]) return state;
      return { nodes: { ...state.nodes, [node.id]: node } };
    });
  },

  addEdges(edges) {
    set((state) => {
      const known = new Set(state.edges.map((e) => e.id));
      const fresh = edges.filter(
        (e) =>
          !known.has(e.id) &&
          !state.removedNodeIds[e.node_id] &&
          !state.removedNodeIds[e.source_node_id],
      );
      if (fresh.length === 0) return state;
      const contextCounts = { ...state.contextCounts };
      for (const e of fresh) {
        contextCounts[e.node_id] = (contextCounts[e.node_id] ?? 0) + 1;
      }
      return { edges: [...state.edges, ...fresh], contextCounts };
    });
  },

  addAttachments(attachments) {
    if (attachments.length === 0) return;
    set((state) => {
      const next = { ...state.attachments };
      let changed = false;
      for (const attachment of attachments) {
        const ownerId = attachment.node_id;
        if (!ownerId || state.removedNodeIds[ownerId]) continue;
        const existing = next[ownerId] ?? [];
        if (existing.some((a) => a.id === attachment.id)) continue;
        next[ownerId] = [...existing, attachment];
        changed = true;
      }
      return changed ? { attachments: next } : state;
    });
  },

  setSuggestions(nodeId, rows) {
    set((state) => ({
      suggestions: {
        ...state.suggestions,
        [nodeId]: [...rows].sort((a, b) => a.position - b.position),
      },
    }));
  },

  markSuggestionTaken(suggestionId, takenAt) {
    set((state) => {
      const next: Record<string, SuggestionRow[]> = {};
      for (const [nodeId, rows] of Object.entries(state.suggestions)) {
        next[nodeId] = rows.map((r) =>
          r.id === suggestionId ? { ...r, taken_at: takenAt } : r,
        );
      }
      return { suggestions: next };
    });
  },

  setSelectedNode(id) {
    set({ selectedNodeId: id });
  },

  setHoveredNode(id) {
    set((state) =>
      state.hoveredNodeId === id ? state : { hoveredNodeId: id },
    );
  },

  setExpandedNode(id) {
    set({ expandedNodeId: id });
  },

  setFocusNode(id) {
    set({ focusNodeId: id });
  },

  setDeletingNodes(ids) {
    set({ deletingNodeIds: ids });
  },

  removeNodes(ids) {
    set((state) => {
      const gone = new Set(ids);
      const nodes: Record<string, CardNode> = {};
      for (const [id, node] of Object.entries(state.nodes)) {
        if (!gone.has(id)) nodes[id] = node;
      }
      const suggestions: Record<string, SuggestionRow[]> = {};
      for (const [id, rows] of Object.entries(state.suggestions)) {
        if (!gone.has(id)) suggestions[id] = rows;
      }
      const attachments: Record<string, CardAttachment[]> = {};
      for (const [id, rows] of Object.entries(state.attachments)) {
        if (!gone.has(id)) attachments[id] = rows;
      }
      const edges = state.edges.filter(
        (e) => !gone.has(e.node_id) && !gone.has(e.source_node_id),
      );
      const removedNodeIds = { ...state.removedNodeIds };
      for (const id of ids) removedNodeIds[id] = true;

      return {
        nodes,
        edges,
        contextCounts: countByConsumer(edges),
        suggestions,
        attachments,
        removedNodeIds,
        deletingNodeIds: [],
        selectedNodeId:
          state.selectedNodeId && gone.has(state.selectedNodeId)
            ? null
            : state.selectedNodeId,
        hoveredNodeId:
          state.hoveredNodeId && gone.has(state.hoveredNodeId)
            ? null
            : state.hoveredNodeId,
        expandedNodeId:
          state.expandedNodeId && gone.has(state.expandedNodeId)
            ? null
            : state.expandedNodeId,
      };
    });
  },

  updateNodeGeometry(id, { x, y, w, h }) {
    set((state) => {
      const node = state.nodes[id];
      if (!node) return state;
      return {
        nodes: {
          ...state.nodes,
          [id]: { ...node, canvas_x: x, canvas_y: y, canvas_w: w, canvas_h: h },
        },
      };
    });
  },
}));
