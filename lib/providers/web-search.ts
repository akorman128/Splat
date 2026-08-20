// A toggle rather than a level, unlike thinking: the three providers agree on
// whether the model may search the web and on almost nothing about how. What
// they do share is that the search runs on the provider's own infrastructure —
// Splat never fetches a page itself, and no extra key is involved.
export const MAX_WEB_SEARCHES = 5;

// Results are pulled into the prompt by the provider, so a model's context
// window has to leave room for them before the reply is sized. Five results of
// a few thousand characters each, rounded up.
export const WEB_SEARCH_RESERVE_TOKENS = MAX_WEB_SEARCHES * 1000;

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
    // An angle-bracketed destination so the brackets a search result URL is
    // full of cannot end the link early.
    const label = (title?.trim() || url).replaceAll("[", "\\[").replaceAll("]", "\\]");
    const target = url.replaceAll("<", "%3C").replaceAll(">", "%3E");
    lines.push(`- [${label}](<${target}>)`);
  }
  if (lines.length === 0) return "";
  return `\n\n---\n\n**Sources**\n\n${lines.join("\n")}\n`;
}
