import type { GraphNodeRef } from "./ancestors";

export type OutlineEntry = { id: string; depth: number };

const byCreation = (a: GraphNodeRef, b: GraphNodeRef) =>
  a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

export function outlineOrder(nodes: GraphNodeRef[]): OutlineEntry[] {
  const known = new Set(nodes.map((n) => n.id));
  const childrenOf = new Map<string | null, GraphNodeRef[]>();
  for (const node of nodes) {
    // A card whose parent was deleted still belongs in the list, as a root.
    const parent =
      node.parent_id && known.has(node.parent_id) ? node.parent_id : null;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), node]);
  }
  for (const list of childrenOf.values()) list.sort(byCreation);

  const entries: OutlineEntry[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const node of childrenOf.get(parent) ?? []) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      entries.push({ id: node.id, depth });
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return entries;
}
