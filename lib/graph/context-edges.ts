import type { GraphEdgeRef, GraphNodeRef } from "./ancestors";

function reachedByParents(
  byId: Map<string, GraphNodeRef>,
  childId: string,
  sourceId: string,
) {
  const seen = new Set<string>();
  let current = byId.get(childId)?.parent_id ?? null;
  while (current && !seen.has(current)) {
    if (current === sourceId) return true;
    seen.add(current);
    current = byId.get(current)?.parent_id ?? null;
  }
  return false;
}

// A context edge earns an arrow only when it says something the parent chain
// does not already say.
export function visibleContextEdges<E extends GraphEdgeRef>(
  nodes: GraphNodeRef[],
  edges: E[],
): E[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return edges.filter(
    (edge) =>
      byId.has(edge.node_id) &&
      byId.has(edge.source_node_id) &&
      !reachedByParents(byId, edge.node_id, edge.source_node_id),
  );
}
