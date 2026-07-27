import type { GraphNodeRef } from "./ancestors";

export function withDescendants(
  nodeIds: string[],
  nodes: GraphNodeRef[],
): string[] {
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parent_id) continue;
    const list = children.get(n.parent_id) ?? [];
    list.push(n.id);
    children.set(n.parent_id, list);
  }

  const result: string[] = [];
  const seen = new Set<string>();
  const queue = [...nodeIds];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    result.push(current);
    queue.push(...(children.get(current) ?? []));
  }
  return result;
}
