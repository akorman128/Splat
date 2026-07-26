import type { NodeRow } from "@/lib/types";

// Card geometry defaults and auto-layout for new nodes. Geometry is owned by
// tldraw at runtime; these only pick a sensible birth position.

export const CARD_W = 380;
export const CARD_H = 340;
const SIBLING_GAP = 48;
const LEVEL_GAP = 120;
const ROOT_GAP = 200;

/** Place a child below-right of its parent, fanning siblings to the right. */
export function childPosition(
  parent: NodeRow,
  allNodes: NodeRow[],
): { x: number; y: number } {
  const siblingCount = allNodes.filter(
    (n) => n.parent_id === parent.id,
  ).length;
  return {
    x: parent.canvas_x + SIBLING_GAP + siblingCount * (CARD_W + SIBLING_GAP),
    y: parent.canvas_y + parent.canvas_h + LEVEL_GAP,
  };
}

/** Place a new root to the right of existing roots. */
export function rootPosition(allNodes: NodeRow[]): { x: number; y: number } {
  const rootCount = allNodes.filter((n) => n.parent_id === null).length;
  return { x: rootCount * (CARD_W + ROOT_GAP), y: 0 };
}
