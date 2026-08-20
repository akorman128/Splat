import type { CatalogModel } from "./models";

// A toggle rather than a level, unlike thinking: the three providers agree on
// whether the model may search the web and on almost nothing about how. What
// they do share is that the search runs on the provider's own infrastructure —
// Splat never fetches a page itself, and no extra key is involved.
export const MAX_WEB_SEARCHES = 5;

// Results are pulled into the prompt by the provider, so a model's context
// window has to leave room for them before the reply is sized. Five results of
// a few thousand characters each, rounded up.
export const WEB_SEARCH_RESERVE_TOKENS = MAX_WEB_SEARCHES * 1000;

export const OPENROUTER_WEB_SEARCH = "openrouter:web_search";

// OpenAI and Anthropic each date their web search tool, and a model only takes
// the one it was built against. The date in the name is the date it shipped, so
// which to send follows from when the model was released — a model older than
// its own tool gets the previous one. Nothing here is inferred from the wording
// of a rejection: a 400 that arrives anyway is the provider's to explain.
type DatedTool<T extends string> = {
  current: T;
  previous: T;
  currentFrom: number;
};

export const ANTHROPIC_WEB_SEARCH = {
  current: "web_search_20260209",
  previous: "web_search_20250305",
  currentFrom: Date.parse("2026-02-09T00:00:00Z"),
} as const satisfies DatedTool<string>;

export const OPENAI_WEB_SEARCH = {
  current: "web_search",
  previous: "web_search_preview",
  currentFrom: Date.parse("2025-08-26T00:00:00Z"),
} as const satisfies DatedTool<string>;

// A model with no catalogue entry is either an alias — which by definition
// names the newest snapshot — or a list we could not reach, and in both cases
// the current tool is the better guess than the older one.
export function datedWebSearchTool<T extends string>(
  spec: DatedTool<T>,
  entry: CatalogModel | null,
): T {
  if (entry?.releasedAt == null) return spec.current;
  return entry.releasedAt >= spec.currentFrom ? spec.current : spec.previous;
}

export function toWebSearch(value: unknown): boolean {
  return value === true;
}

export function webSearchSummary(value: unknown): string | null {
  return value === true ? "web search" : null;
}

export type Citation = { title: string | null; url: string };

// One list under a rule, appended to the answer once the stream is done. The
// providers report which sources were actually cited but not all of them put a
// link in the prose, so this is the only place some answers name their sources.
export function citationsMarkdown(citations: Citation[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const { title, url } of citations) {
    if (seen.has(url)) continue;
    seen.add(url);
    lines.push(`- [${citationLabel(title, url)}](<${citationTarget(url)}>)`);
  }
  if (lines.length === 0) return "";
  return `\n\n---\n\n**Sources**\n\n${lines.join("\n")}\n`;
}

// A page title is whatever was in its <title>, so it reaches us with newlines,
// runs of whitespace and markdown of its own in it. Flattened to one line and
// escaped, because a title that broke out would take the rest of the list with
// it — and the damage would be persisted into the card's answer.
function citationLabel(title: string | null, url: string): string {
  const flattened = title?.replace(/\s+/gu, " ").trim();
  if (!flattened) return url;
  return flattened.replace(/[\\[\]]/gu, (char) => `\\${char}`);
}

// Angle-bracketed destinations end at the first `>`, and a search result URL is
// full of brackets and parens that would otherwise end the link early.
function citationTarget(url: string): string {
  return url.replaceAll("<", "%3C").replaceAll(">", "%3E");
}
