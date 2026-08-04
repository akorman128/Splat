// How hard a card asked its model to reason, in the one vocabulary all three
// providers accept. Null is not a level: it means the card never asked, so the
// provider's own default stands — which is also the only thing a model with no
// reasoning stage, or one too old to know the parameter, will take without a
// 400. That makes null the safe default for a picker that lists every model a
// key can reach.
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

// For the column and for request bodies, neither of which is typed any tighter
// than "a string, maybe".
export function toThinkingLevel(value: unknown): ThinkingLevel | null {
  return isThinkingLevel(value) ? value : null;
}

// Null has nothing worth printing on a card: "the default" is not a fact about
// this card, it is the absence of one.
export function thinkingSummary(value: unknown): string | null {
  const level = toThinkingLevel(value);
  if (!level) return null;
  return level === "off" ? "no thinking" : `${level} thinking`;
}
