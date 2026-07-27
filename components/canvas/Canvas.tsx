"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import {
  Tldraw,
  createShapeId,
  type Editor,
  type TLShapeId,
  type TLUiOverrides,
} from "tldraw";
import "tldraw/tldraw.css";
import { CARD_SHAPE_TYPE, CardShapeUtil, type CardShape } from "./CardShapeUtil";
import { DragPanSelectTool } from "./DragPanSelectTool";
import { useGraphStore } from "@/lib/store/graph-store";
import { visibleContextEdges } from "@/lib/graph/context-edges";
import { createClient } from "@/lib/supabase/client";
import type { ContextEdgeRow, NodeRow } from "@/lib/types";

const shapeUtils = [CardShapeUtil];
const tools = [DragPanSelectTool];
const options = { createTextOnCanvasDoubleClick: false };

const uiOverrides: TLUiOverrides = {
  tools(_editor, tools) {
    return { select: tools.select };
  },
  actions(_editor, actions) {
    delete actions.duplicate;
    delete actions["unlock-all"];
    return actions;
  },
};

type Geometry = { x: number; y: number; w: number; h: number };

const cardShapeId = (nodeId: string): TLShapeId => createShapeId(`card-${nodeId}`);
const parentArrowId = (childId: string): TLShapeId =>
  createShapeId(`parent-arrow-${childId}`);
const contextArrowId = (edgeId: string): TLShapeId =>
  createShapeId(`context-arrow-${edgeId}`);

function createBoundArrow(
  editor: Editor,
  arrowId: TLShapeId,
  fromShapeId: TLShapeId,
  toShapeId: TLShapeId,
  dash: "solid" | "dashed",
) {
  editor.createShape({
    id: arrowId,
    type: "arrow",
    isLocked: true,
    props: {
      dash,
      color: "grey",
      size: "s",
      arrowheadStart: "none",
      arrowheadEnd: "arrow",
    },
  });
  for (const [terminal, targetId] of [
    ["start", fromShapeId],
    ["end", toShapeId],
  ] as const) {
    editor.createBinding({
      type: "arrow",
      fromId: arrowId,
      toId: targetId,
      props: {
        terminal,
        normalizedAnchor: { x: 0.5, y: 0.5 },
        isPrecise: false,
        isExact: false,
        snap: "none",
      },
    });
  }
  editor.sendToBack([arrowId]);
}

function reconcile(
  editor: Editor,
  nodes: Record<string, NodeRow>,
  edges: ContextEdgeRow[],
  removing: { current: boolean },
) {
  const contextEdges = visibleContextEdges(Object.values(nodes), edges);
  const hadShapes = editor.getCurrentPageShapeIds().size > 0;
  let createdAny = false;

  editor.run(
    () => {
      for (const node of Object.values(nodes)) {
        const id = cardShapeId(node.id);
        if (editor.getShape(id)) continue;
        editor.createShape<CardShape>({
          id,
          type: CARD_SHAPE_TYPE,
          x: node.canvas_x,
          y: node.canvas_y,
          props: { w: node.canvas_w, h: node.canvas_h, nodeId: node.id },
        });
        createdAny = true;
      }

      for (const node of Object.values(nodes)) {
        if (!node.parent_id) continue;
        const arrowId = parentArrowId(node.id);
        if (editor.getShape(arrowId)) continue;
        if (
          editor.getShape(cardShapeId(node.parent_id)) &&
          editor.getShape(cardShapeId(node.id))
        ) {
          createBoundArrow(
            editor,
            arrowId,
            cardShapeId(node.parent_id),
            cardShapeId(node.id),
            "solid",
          );
        }
      }

      for (const edge of contextEdges) {
        const arrowId = contextArrowId(edge.id);
        if (editor.getShape(arrowId)) continue;
        if (
          editor.getShape(cardShapeId(edge.source_node_id)) &&
          editor.getShape(cardShapeId(edge.node_id))
        ) {
          createBoundArrow(
            editor,
            arrowId,
            cardShapeId(edge.source_node_id),
            cardShapeId(edge.node_id),
            "dashed",
          );
        }
      }

      const expected = new Set<TLShapeId>();
      for (const node of Object.values(nodes)) {
        expected.add(cardShapeId(node.id));
        if (node.parent_id) expected.add(parentArrowId(node.id));
      }
      for (const edge of contextEdges) expected.add(contextArrowId(edge.id));

      const stale = [...editor.getCurrentPageShapeIds()].filter(
        (id) => !expected.has(id),
      );
      if (stale.length > 0) {
        removing.current = true;
        editor.deleteShapes(stale);
        removing.current = false;
      }
    },
    { history: "ignore", ignoreShapeLock: true },
  );

  // A pending focus frames the canvas itself; fitting first would jump the
  // camera twice on a conversation's opening card.
  if (!hadShapes && createdAny && !useGraphStore.getState().focusNodeId) {
    editor.zoomToFit({ animation: { duration: 0 } });
    if (editor.getZoomLevel() > 1) {
      editor.resetZoom();
    }
  }
}

export default function Canvas() {
  const [editor, setEditor] = useState<Editor | null>(null);
  const { resolvedTheme } = useTheme();
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const focusNodeId = useGraphStore((s) => s.focusNodeId);
  const [initialColorScheme] = useState<"dark" | "light">(() =>
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
      ? "dark"
      : "light",
  );
  const pendingGeometry = useRef(new Map<string, Geometry>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removing = useRef(false);

  useEffect(() => {
    if (editor) reconcile(editor, nodes, edges, removing);
  }, [editor, nodes, edges]);

  useEffect(() => {
    if (!editor || !focusNodeId) return;
    const bounds = editor.getShapePageBounds(cardShapeId(focusNodeId));
    if (bounds) {
      editor.zoomToBounds(bounds, {
        targetZoom: 1,
        animation: { duration: 300 },
      });
    }
    useGraphStore.getState().setFocusNode(null);
  }, [editor, focusNodeId]);

  useEffect(() => {
    if (!editor || !selectedNodeId) return;
    const id = cardShapeId(selectedNodeId);
    if (!editor.getShape(id)) return;
    const current = editor.getSelectedShapeIds();
    if (current.length === 1 && current[0] === id) return;
    editor.select(id);
    editor.zoomToSelectionIfOffscreen(120, { animation: { duration: 200 } });
  }, [editor, selectedNodeId]);

  const { mutate: persistGeometry } = useMutation({
    mutationFn: async ({
      nodeId,
      geometry,
    }: {
      nodeId: string;
      geometry: Geometry;
    }) => {
      const { error } = await createClient()
        .from("nodes")
        .update({
          canvas_x: geometry.x,
          canvas_y: geometry.y,
          canvas_w: geometry.w,
          canvas_h: geometry.h,
        })
        .eq("id", nodeId);
      if (error) {
        console.error("Failed to persist card position:", error.message);
      }
    },
  });

  const flushGeometry = useCallback(() => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    if (pendingGeometry.current.size === 0) return;

    const batch = new Map(pendingGeometry.current);
    pendingGeometry.current.clear();
    const graph = useGraphStore.getState();
    for (const [nodeId, geometry] of batch) {
      graph.updateNodeGeometry(nodeId, geometry);
      persistGeometry({ nodeId, geometry });
    }
  }, [persistGeometry]);

  const beaconGeometry = useCallback(() => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    if (pendingGeometry.current.size === 0) return;

    const updates = [...pendingGeometry.current].map(([id, g]) => ({
      id,
      ...g,
    }));
    pendingGeometry.current.clear();

    const graph = useGraphStore.getState();
    for (const { id, ...geometry } of updates) {
      graph.updateNodeGeometry(id, geometry);
    }

    const payload = new Blob([JSON.stringify({ updates })], {
      type: "application/json",
    });
    if (!navigator.sendBeacon("/api/geometry", payload)) {
      console.error("Failed to queue card positions before unload");
    }
  }, []);

  useEffect(() => {
    return () => flushGeometry();
  }, [flushGeometry]);

  useEffect(() => {
    const onHide = () => beaconGeometry();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") beaconGeometry();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [beaconGeometry]);

  function scheduleGeometryFlush() {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(flushGeometry, 600);
  }

  useEffect(() => {
    if (!editor || !resolvedTheme) return;
    editor.user.updateUserPreferences({
      colorScheme: resolvedTheme === "dark" ? "dark" : "light",
    });
  }, [editor, resolvedTheme]);

  return (
    <div className="absolute inset-0">
      <Tldraw
        licenseKey={process.env.NEXT_PUBLIC_TLDRAW_KEY}
        hideUi
        colorScheme={initialColorScheme}
        shapeUtils={shapeUtils}
        tools={tools}
        options={options}
        overrides={uiOverrides}
        onMount={(mountedEditor) => {
          mountedEditor.setCurrentTool("select");

          const stopDelete = mountedEditor.sideEffects.registerBeforeDeleteHandler(
            "shape",
            (shape) => {
              if (removing.current) return;
              if (shape.type === CARD_SHAPE_TYPE) {
                const selected = mountedEditor
                  .getSelectedShapes()
                  .filter((s): s is CardShape => s.type === CARD_SHAPE_TYPE);
                const batch = selected.some((s) => s.id === shape.id)
                  ? selected
                  : [shape as CardShape];
                if (batch[0].id === shape.id) {
                  useGraphStore
                    .getState()
                    .setDeletingNodes(batch.map((s) => s.props.nodeId));
                }
              }
              return false;
            },
          );

          const stopListen = mountedEditor.sideEffects.registerAfterChangeHandler(
            "shape",
            (prev, next) => {
              if (next.type !== CARD_SHAPE_TYPE) return;
              const prevShape = prev as CardShape;
              const shape = next as CardShape;
              if (
                prevShape.x === shape.x &&
                prevShape.y === shape.y &&
                prevShape.props.w === shape.props.w &&
                prevShape.props.h === shape.props.h
              ) {
                return;
              }
              pendingGeometry.current.set(shape.props.nodeId, {
                x: shape.x,
                y: shape.y,
                w: shape.props.w,
                h: shape.props.h,
              });
              scheduleGeometryFlush();
            },
          );

          const stopSelection = mountedEditor.sideEffects.registerAfterChangeHandler(
            "instance_page_state",
            (prev, next) => {
              if (prev.selectedShapeIds === next.selectedShapeIds) return;
              const graph = useGraphStore.getState();
              if (next.selectedShapeIds.length === 1) {
                const shape = mountedEditor.getShape(next.selectedShapeIds[0]);
                if (shape?.type === CARD_SHAPE_TYPE) {
                  graph.setSelectedNode((shape as CardShape).props.nodeId);
                  return;
                }
              }
              graph.setSelectedNode(null);
            },
          );

          setEditor(mountedEditor);

          return () => {
            stopDelete();
            stopListen();
            stopSelection();
          };
        }}
      />
    </div>
  );
}
