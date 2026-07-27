"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import {
  Tldraw,
  createShapeId,
  type Editor,
  type TLShapeId,
} from "tldraw";
import "tldraw/tldraw.css";
import { CARD_SHAPE_TYPE, CardShapeUtil, type CardShape } from "./CardShapeUtil";
import { useGraphStore } from "@/lib/store/graph-store";
import { createClient } from "@/lib/supabase/client";
import type { ContextEdgeRow, NodeRow } from "@/lib/types";

// tldraw owns geometry only. Cards are created from Supabase-backed rows in
// the graph store; positions are persisted back to nodes.canvas_* debounced.
// Edges are a read-only visualization of parent_id + context_edges: arrows
// are created programmatically, locked (not selectable, so terminals can't
// be re-attached), and protected from deletion; the arrow tool is
// unreachable because hideUi disables tools and their keyboard shortcuts.

const shapeUtils = [CardShapeUtil];

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
) {
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

      // Solid arrow for the structural parent edge.
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

      // Dashed arrows for additional (non-parent) context sources.
      for (const edge of edges) {
        const child = nodes[edge.node_id];
        if (!child || edge.source_node_id === child.parent_id) continue;
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
    },
    { history: "ignore" },
  );

  if (!hadShapes && createdAny) {
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
  // resolvedTheme is undefined until next-themes has run on the client, which
  // is after the editor is built — so read the class its pre-hydration script
  // already put on <html> instead, or a dark-mode user gets a white canvas
  // for a frame on every conversation load.
  const [initialColorScheme] = useState<"dark" | "light">(() =>
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
      ? "dark"
      : "light",
  );
  const pendingGeometry = useRef(new Map<string, Geometry>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (editor) reconcile(editor, nodes, edges);
  }, [editor, nodes, edges]);

  // One row update per moved card. The failure is reported from inside the
  // mutation function rather than an `onError` handler because the flush below
  // also runs on unmount, and by then the observer that would dispatch those
  // callbacks is gone — the request itself still goes out.
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

  // Write whatever geometry is buffered straight through, ignoring the debounce.
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

  // Same buffer, but for a page that is going away. The requests flushGeometry
  // fires are ordinary fetches, and the browser cancels those the moment the
  // document unloads — so a drag followed by a reload inside the debounce
  // window still lost the position even with the unmount flush below.
  // sendBeacon is the transport that outlives the page; /api/geometry exists
  // to receive it.
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

    // Keep the store in step in case the page is restored from bfcache rather
    // than actually torn down.
    const graph = useGraphStore.getState();
    for (const { id, ...geometry } of updates) {
      graph.updateNodeGeometry(id, geometry);
    }

    const payload = new Blob([JSON.stringify({ updates })], {
      type: "application/json",
    });
    if (!navigator.sendBeacon("/api/geometry", payload)) {
      // Queue full or the payload was rejected — nothing better to try at
      // this point in the page's life, but say so rather than fail silently.
      console.error("Failed to queue card positions before unload");
    }
  }, []);

  // Switching conversations unmounts this component (ConversationView renders
  // null for a render while the store re-inits), so a drag followed by a
  // sidebar click inside the 600ms debounce used to be dropped on the floor:
  // the cleanup cleared the timer without ever writing the batch. Flush first.
  useEffect(() => {
    return () => flushGeometry();
  }, [flushGeometry]);

  // pagehide covers reload, navigation and tab close, and unlike beforeunload
  // it does not disqualify the page from bfcache. visibilitychange is the one
  // that actually fires on mobile, where a backgrounded tab can be discarded
  // without ever reaching pagehide.
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

  // Keep the canvas chrome in step with the app's theme. This has to be a
  // preference update rather than the colorScheme prop, because tldraw treats
  // that prop as construction-time config.
  useEffect(() => {
    if (!editor || !resolvedTheme) return;
    editor.user.updateUserPreferences({
      colorScheme: resolvedTheme === "dark" ? "dark" : "light",
    });
  }, [editor, resolvedTheme]);

  return (
    <div className="absolute inset-0">
      <Tldraw
        hideUi
        // Initial value only, and deliberately a constant: tldraw rebuilds the
        // entire editor when this prop changes, which would drop the camera
        // and re-run reconcile on every theme flip. Live changes go through
        // updateUserPreferences in the effect above.
        colorScheme={initialColorScheme}
        shapeUtils={shapeUtils}
        onMount={(mountedEditor) => {
          mountedEditor.setCurrentTool("select");

          // The canvas renders the graph; it does not edit it. No shape —
          // card or arrow — is user-deletable.
          const stopDelete = mountedEditor.sideEffects.registerBeforeDeleteHandler(
            "shape",
            () => false,
          );

          // Persist card geometry on change, debounced.
          // NOTE: editor.store.listen never delivered entries in this tldraw
          // build; the side-effects API is the reliable change hook.
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

          // Mirror single-card selection into the graph store; the composer
          // uses it as the parent for the next prompt.
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
