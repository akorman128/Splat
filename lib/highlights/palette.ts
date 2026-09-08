// Also spelled out in the check constraints of 20260908000013_highlights.sql.
export const HIGHLIGHT_COLORS = [
  "yellow",
  "green",
  "blue",
  "pink",
  "purple",
] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

// Matches the column default.
export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = "yellow";

export const HIGHLIGHT_COLOR_LABELS: Record<HighlightColor, string> = {
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  pink: "Pink",
  purple: "Purple",
};

// The swatch a picker draws. The text itself is painted by ::highlight() rules
// in globals.css, which cannot be reached from a class name.
export const HIGHLIGHT_SWATCHES: Record<HighlightColor, string> = {
  yellow: "bg-[#fde047]",
  green: "bg-[#4ade80]",
  blue: "bg-[#38bdf8]",
  pink: "bg-[#f472b6]",
  purple: "bg-[#c084fc]",
};

// Spelled out rather than derived from HIGHLIGHT_SWATCHES: Tailwind generates
// utilities by scanning source text, so a class built at runtime is a class
// that was never compiled.
export const HIGHLIGHT_BORDERS: Record<HighlightColor, string> = {
  yellow: "border-[#fde047]",
  green: "border-[#4ade80]",
  blue: "border-[#38bdf8]",
  pink: "border-[#f472b6]",
  purple: "border-[#c084fc]",
};

export function isHighlightColor(value: string): value is HighlightColor {
  return (HIGHLIGHT_COLORS as readonly string[]).includes(value);
}

export function asHighlightColor(value: string | null | undefined): HighlightColor {
  return value && isHighlightColor(value) ? value : DEFAULT_HIGHLIGHT_COLOR;
}

// One registered ::highlight() name per colour. Named here so the paint
// registry and the stylesheet cannot drift apart.
export function highlightName(color: HighlightColor): string {
  return `splat-hl-${color}`;
}

// Keep in step with CardHighlight in lib/types.ts.
export const HIGHLIGHT_COLUMNS =
  "id, node_id, quote, prefix, suffix, text_offset, color, note, note_model, note_created_at, note_edited_at, created_at";
