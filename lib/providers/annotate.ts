import "server-only";

// Brevity is the prompt's job, not this number's: it is a ceiling, and on a
// reasoning model the budget covers the thinking as well as the answer, so a
// tight one is spent before a word is written and the reader gets an empty
// response rather than a short one. Matches the follow-ups budget.
export const ANNOTATION_MAX_TOKENS = 2000;

// How much of the answer either side of the quote rides along. A quote lifted
// out of its paragraph is often unreadable on its own — "it does not, for the
// same reason" — and a fast model asked to explain that with no surroundings
// invents the reason.
const CONTEXT_CHARS = 800;

export const MAX_QUESTION_LENGTH = 500;

// The quote is the rendered text the reader dragged over; the response is the
// markdown it was rendered from. The two agree inside a plain paragraph and
// stop agreeing the moment a quote crosses a bold word or a list bullet, so an
// exact search finds the common case and this finds the rest: drop the syntax
// that leaves no text behind, flatten whitespace, and keep the map back to the
// offsets in the original.
const MARKDOWN_NOISE = "*_`~#>[]";

// A list bullet is markup in the source and a CSS marker on screen, so unlike
// the characters above it leaves no text behind at all — a quote lifted from
// two list items has nothing where the source has "- ".
const LIST_MARKER = /^(?:[-+]|\d{1,9}[.)])(?=\s)/;

function squash(text: string): { text: string; map: number[] } {
  let out = "";
  const map: number[] = [];
  let pendingSpace = false;
  let atLineStart = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") {
      pendingSpace = out.length > 0;
      atLineStart = true;
      continue;
    }
    if (/\s/.test(ch)) {
      pendingSpace = out.length > 0;
      continue;
    }
    if (MARKDOWN_NOISE.includes(ch)) continue;
    if (atLineStart) {
      const marker = LIST_MARKER.exec(text.slice(i, i + 12));
      if (marker) {
        i += marker[0].length - 1;
        continue;
      }
      atLineStart = false;
    }
    if (pendingSpace) {
      out += " ";
      map.push(i);
      pendingSpace = false;
    }
    out += ch;
    map.push(i);
  }
  return { text: out, map };
}

// [start, end) in the response, or null when the quote is nowhere in it — a
// card regenerated since the highlight was made.
function locate(response: string, quote: string): [number, number] | null {
  const direct = response.indexOf(quote);
  if (direct >= 0) return [direct, direct + quote.length];

  const haystack = squash(response);
  const needle = squash(quote).text;
  if (!needle) return null;
  const hit = haystack.text.indexOf(needle);
  if (hit < 0) return null;
  return [haystack.map[hit], haystack.map[hit + needle.length - 1] + 1];
}

export function annotationContext(response: string, quote: string): string {
  const found = locate(response, quote);
  if (!found) {
    return response.length > CONTEXT_CHARS * 2
      ? `${response.slice(0, CONTEXT_CHARS * 2)}…`
      : response;
  }
  const [at, end] = found;
  const from = Math.max(0, at - CONTEXT_CHARS);
  const to = Math.min(response.length, end + CONTEXT_CHARS);
  return [
    from > 0 ? "…" : "",
    response.slice(from, to),
    to < response.length ? "…" : "",
  ].join("");
}

export const ANNOTATION_SYSTEM = [
  "You answer a reader's question about one passage they highlighted in a",
  "longer AI-generated answer. Address the highlighted passage specifically,",
  "not the surrounding text, which is given only so you can read the passage",
  "in context. Be direct and concrete: at most 120 words, no preamble, no",
  "restating the question, no offer to help further. Plain prose, or a short",
  "list where that genuinely reads better. Say so plainly if the passage does",
  "not contain enough to answer.",
].join(" ");

export const DEFAULT_QUESTION = "What does this mean?";

export function annotationPrompt(opts: {
  quote: string;
  question: string;
  cardPrompt: string;
  context: string;
}): string {
  return [
    "<original_question>",
    opts.cardPrompt,
    "</original_question>",
    "",
    "<surrounding_text>",
    opts.context,
    "</surrounding_text>",
    "",
    "<highlighted_passage>",
    opts.quote,
    "</highlighted_passage>",
    "",
    "<reader_question>",
    opts.question,
    "</reader_question>",
  ].join("\n");
}

export function cleanAnswer(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("The model returned an empty answer");
  }
  return trimmed;
}
