"use client";

import { visibleContextEdges } from "@/lib/graph/context-edges";
import { estimateTokens } from "@/lib/tokens";
import { thinkingSummary } from "@/lib/providers/thinking";
import type { NodeRow } from "@/lib/types";
import type { ConversationExport } from "./conversation";
import { cardTitle } from "./markdown";

const PADDING = 64;
// Beyond roughly this area browsers hand back a blank canvas instead of pixels,
// and beyond this width or height they do the same however small the area.
const MAX_PIXELS = 16_000_000;
const MAX_DIMENSION = 16_384;
const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`;

const RADIUS = 12;
const HEADER_H = 38;
const PROMPT_H = 42;
const FOOTER_H = 24;
const INSET = 14;
const BODY_LINE_H = 16;

type Palette = {
  background: string;
  card: string;
  strip: string;
  border: string;
  foreground: string;
  mutedForeground: string;
  arrow: string;
  destructive: string;
};

// The theme's oklch tokens resolved to fixed sRGB, so an export looks the same
// whatever the browser does with wide-gamut colour.
const LIGHT: Palette = {
  background: "#ffffff",
  card: "#ffffff",
  strip: "#fafafa",
  border: "#e5e5e5",
  foreground: "#0a0a0a",
  mutedForeground: "#737373",
  arrow: "#a1a1a1",
  destructive: "#dc2626",
};

const DARK: Palette = {
  background: "#0a0a0a",
  card: "#171717",
  strip: "#1f1f1f",
  border: "#333333",
  foreground: "#fafafa",
  mutedForeground: "#a1a1a1",
  arrow: "#737373",
  destructive: "#ef4444",
};

type Rect = { x: number; y: number; w: number; h: number };

function rectOf(node: NodeRow): Rect {
  return { x: node.canvas_x, y: node.canvas_y, w: node.canvas_w, h: node.canvas_h };
}

function centreOf(rect: Rect) {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

// Where the line from a card's centre towards `toward` leaves the card.
function borderPoint(rect: Rect, toward: { x: number; y: number }) {
  const centre = centreOf(rect);
  const dx = toward.x - centre.x;
  const dy = toward.y - centre.y;
  if (dx === 0 && dy === 0) return centre;
  const ratio = Math.min(
    Math.abs(dx) < 1e-6 ? Infinity : rect.w / 2 / Math.abs(dx),
    Math.abs(dy) < 1e-6 ? Infinity : rect.h / 2 / Math.abs(dy),
  );
  return { x: centre.x + dx * ratio, y: centre.y + dy * ratio };
}

function ellipsize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return `${text.slice(0, low).trimEnd()}…`;
}

function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): { lines: string[]; truncated: boolean } {
  if (maxLines <= 0) return { lines: [], truncated: text.trim().length > 0 };
  const lines: string[] = [];
  let truncated = false;

  const push = (line: string) => {
    if (lines.length < maxLines) lines.push(line);
    else truncated = true;
  };

  for (const paragraph of text.split("\n")) {
    if (lines.length >= maxLines) {
      if (paragraph.trim()) truncated = true;
      continue;
    }
    if (!paragraph.trim()) {
      if (lines.length > 0) push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) push(line);
      line = word;
      if (lines.length >= maxLines) break;
    }
    if (line) push(line);
  }

  while (lines.length > 0 && !lines[lines.length - 1]) lines.pop();
  return { lines, truncated };
}

// The cards render markdown; the export draws flat text, so the syntax that
// would otherwise show up as literal asterisks and backticks comes off first.
function plainText(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n?/g, "")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s{0,3}>\s?/, "")
        // Bullets go first, so the marker cannot be mistaken for emphasis.
        .replace(/^[ \t]*[-*+][ \t]+/, "• ")
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        // Lazy, so bold still closes around emphasis nested inside it.
        .replace(/\*\*(\S|\S.*?\S)\*\*/g, "$1")
        // Emphasis markers hug their text; a lone asterisk is multiplication.
        .replace(/\*(\S|\S[^*]*\S)\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1"),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Cut text runs into an ellipsis rather than the "sentence.…" a naive append
// leaves behind.
function withEllipsis(line: string): string {
  return `${line.replace(/[.,;:]+$/, "")}…`;
}

function contextLabel(count: number): string {
  if (count === 0) return "no context";
  return `${count} card${count === 1 ? "" : "s"} in context`;
}

function footerText(node: NodeRow, contextCount: number): string {
  const tokens =
    node.prompt_tokens != null && node.completion_tokens != null
      ? `${node.prompt_tokens}→${node.completion_tokens} tok`
      : `~${estimateTokens(node.prompt + node.response)} tok`;
  return [node.model, thinkingSummary(node.thinking_level), tokens, contextLabel(contextCount)]
    .filter(Boolean)
    .join("  ·  ");
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  from: Rect,
  to: Rect,
  dashed: boolean,
  colour: string,
) {
  const start = borderPoint(from, centreOf(to));
  const end = borderPoint(to, centreOf(from));
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 16) return;

  const ux = dx / length;
  const uy = dy / length;
  const tail = { x: start.x + ux * 4, y: start.y + uy * 4 };
  const head = { x: end.x - ux * 4, y: end.y - uy * 4 };

  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 1.5;
  ctx.setLineDash(dashed ? [7, 5] : []);
  ctx.beginPath();
  ctx.moveTo(tail.x, tail.y);
  ctx.lineTo(head.x, head.y);
  ctx.stroke();

  ctx.setLineDash([]);
  const angle = Math.atan2(dy, dx);
  const spread = Math.PI / 7;
  const size = 10;
  ctx.beginPath();
  ctx.moveTo(head.x, head.y);
  ctx.lineTo(
    head.x - size * Math.cos(angle - spread),
    head.y - size * Math.sin(angle - spread),
  );
  ctx.lineTo(
    head.x - size * Math.cos(angle + spread),
    head.y - size * Math.sin(angle + spread),
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  node: NodeRow,
  palette: Palette,
  contextCount: number,
) {
  const { x, y, w, h } = rectOf(node);
  const isError = node.status === "error";
  const innerW = w - INSET * 2;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, RADIUS);
  ctx.fillStyle = palette.card;
  ctx.fill();
  ctx.clip();

  ctx.fillStyle = palette.strip;
  ctx.fillRect(x, y + HEADER_H, w, PROMPT_H);

  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 1;
  for (const lineY of [y + HEADER_H, y + HEADER_H + PROMPT_H, y + h - FOOTER_H]) {
    ctx.beginPath();
    ctx.moveTo(x, lineY + 0.5);
    ctx.lineTo(x + w, lineY + 0.5);
    ctx.stroke();
  }

  ctx.font = `600 16px ${FONT}`;
  ctx.fillStyle = palette.foreground;
  ctx.fillText(ellipsize(ctx, cardTitle(node), innerW), x + INSET, y + 25);

  ctx.font = `12px ${FONT}`;
  ctx.fillStyle = palette.mutedForeground;
  const prompt = wrap(ctx, node.prompt.trim(), innerW, 2);
  prompt.lines.forEach((line, index) => {
    const text =
      index === prompt.lines.length - 1 && prompt.truncated
        ? withEllipsis(line)
        : line;
    ctx.fillText(ellipsize(ctx, text, innerW), x + INSET, y + HEADER_H + 17 + index * 15);
  });

  const bodyTop = y + HEADER_H + PROMPT_H;
  const bodyH = h - HEADER_H - PROMPT_H - FOOTER_H;
  const maxLines = Math.max(0, Math.floor((bodyH - 14) / BODY_LINE_H));
  const response = plainText(node.response);

  ctx.font = `13px ${FONT}`;
  if (response) {
    ctx.fillStyle = palette.foreground;
    const body = wrap(ctx, response, innerW, maxLines);
    body.lines.forEach((line, index) => {
      const text =
        index === body.lines.length - 1 && body.truncated
          ? withEllipsis(line)
          : line;
      ctx.fillText(ellipsize(ctx, text, innerW), x + INSET, bodyTop + 20 + index * BODY_LINE_H);
    });
  } else if (maxLines > 0) {
    ctx.fillStyle = isError ? palette.destructive : palette.mutedForeground;
    const placeholder = isError
      ? `Interrupted: ${node.error_message ?? "the answer never arrived."}`
      : node.status === "complete"
        ? "No response."
        : "Waiting for the answer…";
    wrap(ctx, placeholder, innerW, maxLines).lines.forEach((line, index) => {
      ctx.fillText(ellipsize(ctx, line, innerW), x + INSET, bodyTop + 20 + index * BODY_LINE_H);
    });
  }

  ctx.font = `10px ${FONT}`;
  ctx.fillStyle = palette.mutedForeground;
  ctx.fillText(
    ellipsize(ctx, footerText(node, contextCount), innerW),
    x + INSET,
    y + h - 9,
  );
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, RADIUS);
  ctx.strokeStyle = isError ? palette.destructive : palette.border;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function isDarkMode(): boolean {
  return document.documentElement.classList.contains("dark");
}

export async function toPng(
  { nodes, edges }: ConversationExport,
  dark: boolean = isDarkMode(),
): Promise<Blob> {
  if (nodes.length === 0) throw new Error("This conversation has no cards yet.");
  const palette = dark ? DARK : LIGHT;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.canvas_x);
    minY = Math.min(minY, node.canvas_y);
    maxX = Math.max(maxX, node.canvas_x + node.canvas_w);
    maxY = Math.max(maxY, node.canvas_y + node.canvas_h);
  }

  const width = maxX - minX + PADDING * 2;
  const height = maxY - minY + PADDING * 2;
  const scale = Math.min(
    2,
    Math.sqrt(MAX_PIXELS / (width * height)),
    MAX_DIMENSION / width,
    MAX_DIMENSION / height,
  );

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot render the image.");

  ctx.scale(scale, scale);
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, width, height);
  ctx.translate(PADDING - minX, PADDING - minY);
  ctx.textBaseline = "alphabetic";

  const rects = new Map(nodes.map((node) => [node.id, rectOf(node)]));

  for (const node of nodes) {
    const from = node.parent_id ? rects.get(node.parent_id) : undefined;
    const to = rects.get(node.id);
    if (from && to) drawArrow(ctx, from, to, false, palette.arrow);
  }
  for (const edge of visibleContextEdges(nodes, edges)) {
    const from = rects.get(edge.source_node_id);
    const to = rects.get(edge.node_id);
    if (from && to) drawArrow(ctx, from, to, true, palette.arrow);
  }

  const contextCounts = new Map<string, number>();
  for (const edge of edges) {
    contextCounts.set(edge.node_id, (contextCounts.get(edge.node_id) ?? 0) + 1);
  }
  for (const node of nodes) {
    drawCard(ctx, node, palette, contextCounts.get(node.id) ?? 0);
  }

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Could not encode the image.")),
      "image/png",
    );
  });
}
