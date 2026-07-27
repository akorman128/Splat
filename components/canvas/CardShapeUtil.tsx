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
import { zoomToCard } from "./zoomToCard";

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
    return true;
  }

  override onDoubleClick(shape: CardShape) {
    zoomToCard(this.editor, shape.id);
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
