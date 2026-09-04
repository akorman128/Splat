import { parentChain, type GraphNodeRef } from "./ancestors";
import { firstRootId } from "./neighbours";

const byCreation = (a: GraphNodeRef, b: GraphNodeRef) =>
  a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

// The chat view reads the branching graph as one lineage: up the parent chain
// from the anchor, then down through oldest children to a leaf — the same path
// the arrow keys walk on the canvas.
export function threadOf(
  nodes: GraphNodeRef[],
  anchorId: string | null,
): string[] {
  const known = new Set(nodes.map((n) => n.id));
  const anchor =
    anchorId && known.has(anchorId) ? anchorId : firstRootId(nodes);
  if (!anchor) return [];

  // A card can arrive over realtime before the parent it names, and the chain
  // walks that id before finding it is not there yet.
  const thread = parentChain(anchor, nodes).filter((id) => known.has(id));
  const seen = new Set(thread);
  let current = anchor;
  for (;;) {
    const next = nodes
      .filter((n) => n.parent_id === current)
      .sort(byCreation)[0];
    if (!next || seen.has(next.id)) break;
    seen.add(next.id);
    thread.push(next.id);
    current = next.id;
  }
  return thread;
}

// The node's branch group: itself and every card sharing its parent, in the
// order ←/→ walk them on the canvas.
export function siblingIds(nodes: GraphNodeRef[], id: string): string[] {
  const current = nodes.find((n) => n.id === id);
  if (!current) return [];
  return nodes
    .filter((n) => n.parent_id === current.parent_id)
    .sort(byCreation)
    .map((n) => n.id);
}
