"use client";

import { create } from "zustand";
import type { ContextEdgeRow, NodeRow, SuggestionRow } from "@/lib/types";

// Application state for the loaded conversation. Supabase is the source of
// truth for graph semantics; this store mirrors it on the client. tldraw
// shapes hold only a nodeId and read everything else from here.

type GraphState = {
  conversationId: string | null;
  nodes: Record<string, NodeRow>;
  edges: ContextEdgeRow[];
  suggestions: Record<string, SuggestionRow[]>;
  selectedNodeId: string | null;
  expandedNodeId: string | null;

  init(payload: {
    conversationId: string;
    nodes: NodeRow[];
    edges: ContextEdgeRow[];
    suggestions: SuggestionRow[];
  }): void;
  upsertNode(node: NodeRow): void;
  addEdges(edges: ContextEdgeRow[]): void;
  setSuggestions(nodeId: string, rows: SuggestionRow[]): void;
  markSuggestionTaken(suggestionId: string, takenAt: string): void;
  setSelectedNode(id: string | null): void;
  setExpandedNode(id: string | null): void;
  updateNodeGeometry(
    id: string,
    geometry: { x: number; y: number; w: number; h: number },
  ): void;
};

export const useGraphStore = create<GraphState>((set) => ({
  conversationId: null,
  nodes: {},
  edges: [],
  suggestions: {},
  selectedNodeId: null,
  expandedNodeId: null,

  init({ conversationId, nodes, edges, suggestions }) {
    const suggestionMap: Record<string, SuggestionRow[]> = {};
    for (const s of suggestions) {
      (suggestionMap[s.node_id] ??= []).push(s);
    }
    for (const list of Object.values(suggestionMap)) {
      list.sort((a, b) => a.position - b.position);
    }
    set({
      conversationId,
      nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
      edges,
      suggestions: suggestionMap,
      selectedNodeId: null,
      expandedNodeId: null,
    });
  },

  upsertNode(node) {
    set((state) => {
      if (state.conversationId !== node.conversation_id) return state;
      return { nodes: { ...state.nodes, [node.id]: node } };
    });
  },

  addEdges(edges) {
    set((state) => {
      const known = new Set(state.edges.map((e) => e.id));
      const fresh = edges.filter((e) => !known.has(e.id));
      if (fresh.length === 0) return state;
      return { edges: [...state.edges, ...fresh] };
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

  setExpandedNode(id) {
    set({ expandedNodeId: id });
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
