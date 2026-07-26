"use client";

import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type TLShape,
} from "tldraw";
import { CARD_H, CARD_W } from "@/lib/layout";
import { CardBody } from "./CardBody";

// Custom tldraw shape for a conversation node. Per the architecture split,
// props hold a nodeId and geometry — nothing else meaningful. All content is
// read from the graph/stream stores keyed by that id, so streaming tokens
// never touch the tldraw shape store.

export const CARD_SHAPE_TYPE = "node-card" as const;

declare module "tldraw" {
  export interface TLGlobalShapePropsMap {
    [CARD_SHAPE_TYPE]: { w: number; h: number; nodeId: string };
  }
}

export type CardShape = TLShape<typeof CARD_SHAPE_TYPE>;

export class CardShapeUtil extends ShapeUtil<CardShape> {
  static override type = CARD_SHAPE_TYPE;
  static override props: RecordProps<CardShape> = {
    w: T.number,
    h: T.number,
    nodeId: T.string,
  };

  getDefaultProps(): CardShape["props"] {
    return { w: CARD_W, h: CARD_H, nodeId: "" };
  }

  // Cards are fixed-size (expanded view is an overlay, not a resize),
  // move-only on the canvas.
  override canResize() {
    return false;
  }
  override canEdit() {
    return false;
  }
  override hideResizeHandles() {
    return true;
  }
  override hideRotateHandle() {
    return true;
  }
  override canBind() {
    // Only our programmatic arrow bindings exist; the arrow tool is
    // unreachable (hideUi disables tools and their shortcuts).
    return true;
  }

  getGeometry(shape: CardShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  component(shape: CardShape) {
    return (
      <HTMLContainer
        style={{
          width: shape.props.w,
          height: shape.props.h,
          pointerEvents: "all",
        }}
      >
        <CardBody nodeId={shape.props.nodeId} />
      </HTMLContainer>
    );
  }

  getIndicatorPath(shape: CardShape) {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 12);
    return path;
  }
}
