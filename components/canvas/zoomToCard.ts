"use client";

import type { Box, Editor, TLShapeId } from "tldraw";

const EDGE_INSET = 32;

// The composer floats over the bottom of the canvas, so a zoomed card is fitted
// into the space above it rather than into the whole viewport.
function fittableHeight(viewport: Box): number {
  const bar = document.querySelector("[data-composer-bar]");
  if (!bar) return viewport.height;
  const top = bar.getBoundingClientRect().top - viewport.y;
  return Math.max(top, viewport.height / 2);
}

export function zoomToCard(editor: Editor, shapeId: TLShapeId) {
  const bounds = editor.getShapePageBounds(shapeId);
  if (!bounds) return;

  const viewport = editor.getViewportScreenBounds();
  const height = fittableHeight(viewport);
  const zoom = Math.max(
    0.1,
    Math.min(
      (viewport.width - EDGE_INSET * 2) / bounds.w,
      (height - EDGE_INSET * 2) / bounds.h,
    ),
  );

  editor.setCamera(
    {
      x: -bounds.x + (viewport.width - bounds.w * zoom) / 2 / zoom,
      y: -bounds.y + (height - bounds.h * zoom) / 2 / zoom,
      z: zoom,
    },
    { animation: { duration: 300 } },
  );
}
