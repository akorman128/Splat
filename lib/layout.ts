import type { NodeRow } from "@/lib/types";

export const CARD_W = 380;
export const CARD_H = 340;
const SIBLING_GAP = 48;
const LEVEL_GAP = 120;
const ROOT_GAP = 200;

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

export function rootPosition(allNodes: NodeRow[]): { x: number; y: number } {
  const rootCount = allNodes.filter((n) => n.parent_id === null).length;
  return { x: rootCount * (CARD_W + ROOT_GAP), y: 0 };
}
