export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// One decimal below ten, none above, and never a trailing .0 — rounding before
// choosing the format matters, or 9999 reads "10.0k" next to 10000's "10k".
function scaled(value: number): string {
  return value < 9.95
    ? value.toFixed(1).replace(/\.0$/, "")
    : String(Math.round(value));
}

// A file's estimate runs to five digits where a card's runs to three, and a
// column of raw numbers stops being comparable at a glance. The suffix is what
// the model list needs ("128k ctx"); everything else wants the bare number.
export function formatTokens(tokens: number, suffix?: string): string {
  const unit = suffix ? ` ${suffix}` : "";
  if (tokens >= 1_000_000) return `${scaled(tokens / 1_000_000)}M${unit}`;
  if (tokens >= 1000) return `${scaled(tokens / 1000)}k${unit}`;
  return `${tokens}${unit}`;
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
