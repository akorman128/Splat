import type { GraphNodeRef } from "./ancestors";

export type Neighbours = {
  parentId: string | null;
  childId: string | null;
  prevSiblingId: string | null;
  nextSiblingId: string | null;
};

const NO_NEIGHBOURS: Neighbours = {
  parentId: null,
  childId: null,
  prevSiblingId: null,
  nextSiblingId: null,
};

const byCreation = (a: GraphNodeRef, b: GraphNodeRef) =>
  a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

// Up/down walk the parent_id lineage the canvas draws as solid arrows. A node
// can have several children, so down enters the oldest branch and left/right
// swap between branches at the current depth.
export function neighboursOf(
  nodes: GraphNodeRef[],
  id: string | null,
): Neighbours {
  const current = id ? nodes.find((n) => n.id === id) : undefined;
  if (!current) return NO_NEIGHBOURS;

  const siblings = nodes
    .filter((n) => n.parent_id === current.parent_id)
    .sort(byCreation);
  const children = nodes
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

export function firstRootId(nodes: GraphNodeRef[]): string | null {
  const roots = nodes.filter((n) => !n.parent_id).sort(byCreation);
  return roots[0]?.id ?? null;
}
