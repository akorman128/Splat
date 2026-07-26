// Pure graph helpers shared by the client (context picker) and the server
// (context validation). The DAG's edge set is the union of parent links and
// explicit context edges; both always point from an older node to a newer one.

export type GraphNodeRef = {
  id: string;
  parent_id: string | null;
  created_at: string;
};

export type GraphEdgeRef = {
  node_id: string; // the consumer (child)
  source_node_id: string; // the ancestor
};

/**
 * Every ancestor of `nodeId` reachable via parent links or context edges.
 * Does not include `nodeId` itself.
 */
export function ancestorsOf(
  nodeId: string,
  nodes: GraphNodeRef[],
  edges: GraphEdgeRef[],
): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    const list = incoming.get(e.node_id) ?? [];
    list.push(e.source_node_id);
    incoming.set(e.node_id, list);
  }

  const result = new Set<string>();
  const queue: string[] = [nodeId];
  while (queue.length > 0) {
    const current = queue.pop()!;
    const parents: string[] = [];
    const node = byId.get(current);
    if (node?.parent_id) parents.push(node.parent_id);
    parents.push(...(incoming.get(current) ?? []));
    for (const p of parents) {
      if (!result.has(p)) {
        result.add(p);
        queue.push(p);
      }
    }
  }
  return result;
}

/**
 * The parent chain from `nodeId` back to its root, oldest first,
 * including `nodeId` itself. This is the default context set.
 */
export function parentChain(
  nodeId: string,
  nodes: GraphNodeRef[],
): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain: string[] = [];
  let current: string | null = nodeId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = byId.get(current)?.parent_id ?? null;
  }
  return chain.reverse();
}
