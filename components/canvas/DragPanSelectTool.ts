"use client";

import {
  SelectTool,
  StateNode,
  Vec,
  type TLPointerEventInfo,
  type TLStateNodeConstructor,
} from "tldraw";

class PanningCanvas extends StateNode {
  static override id = "panning_canvas";
  static override trackPerformance = true;

  private cameraAtStart = new Vec();

  override onEnter() {
    this.editor.stopCameraAnimation();
    this.cameraAtStart = Vec.From(this.editor.getCamera());
    this.editor.setCursor({ type: "grabbing", rotation: 0 });
  }

  override onPointerMove() {
    const { editor } = this;
    const delta = Vec.Sub(
      editor.inputs.getCurrentScreenPoint(),
      editor.inputs.getOriginScreenPoint(),
    ).div(editor.getZoomLevel());
    if (delta.len2() === 0) return;
    editor.setCamera(this.cameraAtStart.clone().add(delta));
  }

  override onPointerUp() {
    this.parent.transition("idle");
  }

  override onCancel() {
    this.parent.transition("idle");
  }

  override onComplete() {
    this.parent.transition("idle");
  }

  override onInterrupt() {
    this.parent.transition("idle");
  }
}

class PointingCanvas extends StateNode {
  static override id = "pointing_canvas";

  override onEnter(info: TLPointerEventInfo) {
    if (info.shiftKey || info.accelKey) return;
    if (this.editor.getSelectedShapeIds().length > 0) {
      this.editor.markHistoryStoppingPoint("selecting none");
      this.editor.selectNone();
    }
  }

  override onPointerMove(info: TLPointerEventInfo) {
    if (!this.editor.inputs.getIsDragging()) return;
    const additive = info.shiftKey || info.accelKey;
    this.parent.transition(additive ? "brushing" : "panning_canvas", info);
  }

  override onPointerUp() {
    this.parent.transition("idle");
  }

  override onCancel() {
    this.parent.transition("idle");
  }

  override onComplete() {
    this.parent.transition("idle");
  }

  override onInterrupt() {
    this.parent.transition("idle");
  }
}

export class DragPanSelectTool extends SelectTool {
  static override children(): TLStateNodeConstructor[] {
    return [
      ...SelectTool.children().filter((child) => child.id !== PointingCanvas.id),
      PointingCanvas,
      PanningCanvas,
    ];
  }
}
