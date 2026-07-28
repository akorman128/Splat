export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// A file's estimate runs to five digits where a card's runs to three, and a
// column of raw numbers stops being comparable at a glance.
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  const thousands = tokens / 1000;
  return `${thousands < 10 ? thousands.toFixed(1) : Math.round(thousands)}k`;
}

// Anthropic's published rule of thumb — width * height / 750 — which OpenAI's
// tiles and OpenRouter's per-model accounting both land near enough to. Capped
// at the ~1568px ceiling every provider downscales to, so an enormous upload
// cannot inflate the running total the composer shows.
export const IMAGE_TOKEN_ESTIMATE = 1100;

export function estimateImageTokens(
  width: number | null,
  height: number | null,
): number {
  if (!width || !height) return IMAGE_TOKEN_ESTIMATE;
  return Math.min(1600, Math.ceil((width * height) / 750));
}
