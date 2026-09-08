export type TextAnchor = {
  quote: string;
  prefix: string;
  suffix: string;
  textOffset: number;
};

// Enough context to tell two identical sentences apart without storing a
// meaningful slice of the answer twice.
const CONTEXT_CHARS = 48;

export const MAX_QUOTE_LENGTH = 2000;

// The flattened text of a rendered response, plus the map back to the nodes it
// came from. Offsets into `text` are what a highlight stores; a Range is what
// the browser paints, and this is the only thing that converts between them.
//
// Built by the caller and passed in, because building it walks the whole
// response: a card with several highlights repaints all of them on every
// streamed token, and one walk per token is affordable where one per
// highlight per token is not.
export type TextMap = { text: string; nodes: Text[]; starts: number[] };

// Anything the reader did not read: the badge rail drawn over the prose, and
// whatever a markdown plugin parked out of view.
const SKIP = "[data-highlight-skip], script, style";

// The elements react-markdown renders as their own line. Two text nodes under
// different ones are visually separated, and a quote spanning them has to
// carry that break: concatenated bare, "…end of the paragraph" and "The next
// one…" glue into one word that the reader never selected and that no search
// of the markdown behind it can find.
const BLOCK =
  "address,blockquote,dd,div,dl,dt,figcaption,figure,h1,h2,h3,h4,h5,h6,hr,li,ol,p,pre,table,td,th,tr,ul";

function blockOf(node: Text, root: HTMLElement): Element {
  const block = node.parentElement?.closest(BLOCK);
  return block && root.contains(block) ? block : root;
}

export function textMapOf(root: HTMLElement): TextMap {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
      return node.parentElement?.closest(SKIP)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = "";
  let prevBlock: Element | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const block = blockOf(node as Text, root);
    // The separator belongs to no node, so it sits in the gap between two
    // entries in `starts`. trimmedBounds keeps a quote from ever beginning or
    // ending on it, and positionAt resolves it to the end of the node before.
    if (prevBlock && block !== prevBlock && !text.endsWith("\n")) text += "\n";
    prevBlock = block;
    nodes.push(node as Text);
    starts.push(text.length);
    text += node.nodeValue;
  }
  return { text, nodes, starts };
}

// The point (container, offset) as an offset into the flat text. An element
// container means "before this child", and the flat text has no separate
// position for that — the start of the next text node is the same place.
function flatOffsetOf(
  map: TextMap,
  container: Node,
  offset: number,
): number {
  if (container.nodeType === Node.TEXT_NODE) {
    const index = map.nodes.indexOf(container as Text);
    if (index >= 0) return map.starts[index] + offset;
  }

  const probe = document.createRange();
  try {
    probe.setStart(container, offset);
    probe.collapse(true);
  } catch {
    return 0;
  }
  for (let i = 0; i < map.nodes.length; i++) {
    if (probe.comparePoint(map.nodes[i], 0) >= 0) return map.starts[i];
  }
  return map.text.length;
}

// An offset on the seam between two text nodes is two different points: the
// end of one node, or the start of the next. A range's end wants the former —
// ended at (next, 0) its last client rect can sit on the following line, and
// the badge placed from it lands at the start of that line instead of after
// the quote.
function positionAt(
  map: TextMap,
  offset: number,
  atEnd = false,
): [Text, number] | null {
  if (map.nodes.length === 0) return null;
  let lo = 0;
  let hi = map.nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (map.starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  if (atEnd && lo > 0 && map.starts[lo] === offset) lo--;
  const node = map.nodes[lo];
  return [node, Math.min(offset - map.starts[lo], node.length)];
}

function rangeBetween(map: TextMap, start: number, end: number): Range | null {
  const from = positionAt(map, start);
  const to = positionAt(map, end, true);
  if (!from || !to) return null;
  const range = document.createRange();
  try {
    range.setStart(from[0], from[1]);
    range.setEnd(to[0], to[1]);
  } catch {
    return null;
  }
  return range;
}

// A selection nearly always carries a trailing space, and sometimes a leading
// one. Storing it would put the highlight's edge in the gap between two words
// and make the badge float away from the sentence it belongs to.
function trimmedBounds(text: string, start: number, end: number): [number, number] {
  let from = start;
  let to = end;
  while (from < to && /\s/.test(text[from])) from++;
  while (to > from && /\s/.test(text[to - 1])) to--;
  return [from, to];
}

export function anchorFromRange(
  map: TextMap,
  range: Range,
): TextAnchor | null {
  const rawStart = flatOffsetOf(map, range.startContainer, range.startOffset);
  const rawEnd = flatOffsetOf(map, range.endContainer, range.endOffset);
  const [start, trimmedEnd] = trimmedBounds(
    map.text,
    Math.min(rawStart, rawEnd),
    Math.max(rawStart, rawEnd),
  );
  if (trimmedEnd <= start) return null;

  let end = Math.min(trimmedEnd, start + MAX_QUOTE_LENGTH);
  if (end < trimmedEnd) {
    // Half of an astral character is a lone surrogate, which Postgres rejects
    // as an invalid unicode escape — the insert fails rather than the quote
    // arriving clipped.
    const lead = map.text.charCodeAt(end - 1);
    if (lead >= 0xd800 && lead <= 0xdbff) end--;
    while (end > start && /\s/.test(map.text[end - 1])) end--;
  }
  if (end <= start) return null;

  return {
    quote: map.text.slice(start, end),
    prefix: map.text.slice(Math.max(0, start - CONTEXT_CHARS), start),
    suffix: map.text.slice(end, end + CONTEXT_CHARS),
    textOffset: start,
  };
}

function commonSuffix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

// Where the quote sits now. The stored offset is checked first because it is
// almost always still right and costs a slice; only a response that has changed
// under the highlight — a regenerate — pays for the search.
export function locateAnchor(text: string, anchor: TextAnchor): number | null {
  if (!anchor.quote) return null;
  if (text.startsWith(anchor.quote, anchor.textOffset)) return anchor.textOffset;

  let best: number | null = null;
  let bestScore = -1;
  for (let i = text.indexOf(anchor.quote); i >= 0; i = text.indexOf(anchor.quote, i + 1)) {
    const score =
      commonSuffix(anchor.prefix, text.slice(0, i)) +
      commonPrefix(anchor.suffix, text.slice(i + anchor.quote.length));
    // Ties go to the occurrence nearest where it used to be.
    if (
      score > bestScore ||
      (score === bestScore &&
        best !== null &&
        Math.abs(i - anchor.textOffset) < Math.abs(best - anchor.textOffset))
    ) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

export function rangeForAnchor(
  map: TextMap,
  anchor: TextAnchor,
): Range | null {
  const start = locateAnchor(map.text, anchor);
  if (start === null) return null;
  return rangeBetween(map, start, start + anchor.quote.length);
}
