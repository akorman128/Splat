// Null is not one of these: it means no level was asked for, and so no
// parameter is sent at all — the only thing a model without a reasoning stage
// accepts, and the picker lists every model a key can reach.
export const THINKING_LEVELS = ["off", "low", "medium", "high", "max"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: "Off",
  low: "Low",
  medium: "Medium",
  high: "High",
  max: "Max",
};

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return (
    typeof value === "string" &&
    (THINKING_LEVELS as readonly string[]).includes(value)
  );
}

export function toThinkingLevel(value: unknown): ThinkingLevel | null {
  return isThinkingLevel(value) ? value : null;
}

export function thinkingSummary(value: unknown): string | null {
  const level = toThinkingLevel(value);
  if (!level) return null;
  return level === "off" ? "no thinking" : `${level} thinking`;
}
