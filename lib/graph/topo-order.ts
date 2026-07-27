import type { GraphEdgeRef, GraphNodeRef } from "./ancestors";

export function topoOrder(
  ids: string[],
  nodes: GraphNodeRef[],
  edges: GraphEdgeRef[],
): string[] {
  const subset = new Set(ids);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const id of ids) indegree.set(id, 0);

  const addEdge = (from: string, to: string) => {
    if (!subset.has(from) || !subset.has(to)) return;
    outgoing.set(from, [...(outgoing.get(from) ?? []), to]);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  };

  for (const id of ids) {
    const parent = byId.get(id)?.parent_id;
    if (parent) addEdge(parent, id);
  }
  for (const e of edges) addEdge(e.source_node_id, e.node_id);

  const ready = ids
    .filter((id) => (indegree.get(id) ?? 0) === 0)
    .sort(byCreatedAt(byId));
  const result: string[] = [];

  while (ready.length > 0) {
    const id = ready.shift()!;
    result.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) {
        ready.push(next);
        ready.sort(byCreatedAt(byId));
      }
    }
  }

  if (result.length !== ids.length) {
    const emitted = new Set(result);
    for (const id of ids) if (!emitted.has(id)) result.push(id);
  }
  return result;
}

function byCreatedAt(byId: Map<string, GraphNodeRef>) {
  return (a: string, b: string) =>
    (byId.get(a)?.created_at ?? "").localeCompare(byId.get(b)?.created_at ?? "");
}
