import { ancestorsOf, type GraphEdgeRef, type GraphNodeRef } from "./ancestors";

/**
 * Validate the context set for a node being created. Context sources must
 * all be ancestors of the new node — i.e. the parent itself or an ancestor
 * of the parent — which makes the resulting graph acyclic by construction
 * (a brand-new node has no descendants). A DB trigger backstops this.
 *
 * Returns null when valid, otherwise a human-readable problem.
 */
export function validateContextSelection({
  parentId,
  contextNodeIds,
  nodes,
  edges,
}: {
  parentId: string | null;
  contextNodeIds: string[];
  nodes: GraphNodeRef[];
  edges: GraphEdgeRef[];
}): string | null {
  if (contextNodeIds.length === 0) return null;
  if (!parentId) {
    return "A root node cannot take context (it has no ancestors)";
  }
  const allowed = ancestorsOf(parentId, nodes, edges);
  allowed.add(parentId);
  for (const id of contextNodeIds) {
    if (!allowed.has(id)) {
      return `Context node ${id} is not an ancestor of the new node`;
    }
  }
  return null;
}
