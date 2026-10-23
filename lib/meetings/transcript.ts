import type { Json } from "@/lib/supabase/types";

export type TranscriptLine = {
  speaker: string;
  text: string;
};

export type Section = TranscriptLine;

// One section is one speech request, so this is also how long the first play
// waits before any audio starts.
const MAX_SECTION_CHARS = 1000;

export function asTranscript(value: Json): TranscriptLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const { speaker, text } = item;
    if (typeof speaker !== "string" || typeof text !== "string") return [];
    return [{ speaker, text }];
  });
}

export function toSections(lines: TranscriptLine[]): Section[] {
  const sections: Section[] = [];
  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    const last = sections.at(-1);
    if (
      last &&
      last.speaker === line.speaker &&
      last.text.length + text.length + 1 <= MAX_SECTION_CHARS
    ) {
      last.text = `${last.text} ${text}`;
    } else {
      sections.push({ speaker: line.speaker, text });
    }
  }
  return sections;
}

export function speakersInOrder(sections: Section[]): string[] {
  return [...new Set(sections.map((s) => s.speaker))];
}

export function transcriptDocument(
  title: string,
  metAt: string,
  lines: TranscriptLine[],
): string {
  const turns: TranscriptLine[] = [];
  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    const last = turns.at(-1);
    if (last && last.speaker === line.speaker) {
      last.text = `${last.text} ${text}`;
    } else {
      turns.push({ speaker: line.speaker, text });
    }
  }
  const body = turns.map((turn) => `${turn.speaker}: ${turn.text}`);
  return [`# ${title}`, `Meeting transcript, ${metAt}`, ...body].join("\n\n");
}
