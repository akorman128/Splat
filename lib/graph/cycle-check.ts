import { ancestorsOf, type GraphEdgeRef, type GraphNodeRef } from "./ancestors";

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
