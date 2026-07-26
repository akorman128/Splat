import "server-only";
import { z } from "zod";

// Shared schema + prompt for the structured "title + 3 suggestions" call.
// Three separate string properties (not an array with minItems/maxItems)
// because strict-mode schema support for array-length constraints differs
// between providers; three required fields guarantees exactly three.
//
// Declared as a Zod object so both adapters can hand it to their SDK's
// structured-output helper (zodOutputFormat / zodTextFormat) and use the
// SDK's own parse path. That validates the payload as well as decoding it —
// a hand-rolled JSON.parse returns `any`, so a model that omitted a field
// (or a truncated body) only blew up later, on `.trim()` of undefined.

export const FollowupsSchema = z.object({
  title: z
    .string()
    .describe(
      "A description of the gist of the user's prompt, six words maximum. Not a truncation of the prompt text.",
    ),
  suggestion1: z
    .string()
    .describe("A concrete follow-up prompt the user might ask next."),
  suggestion2: z.string().describe("A second, distinct follow-up prompt."),
  suggestion3: z.string().describe("A third, distinct follow-up prompt."),
});

export function followupsPrompt(prompt: string, response: string): string {
  const clippedResponse =
    response.length > 8000 ? `${response.slice(0, 8000)}…` : response;
  return [
    "You generate metadata for a card in a graph-based AI chat canvas.",
    "Given the user's prompt and the assistant's response, produce a title",
    "(the gist of the prompt in at most six words) and exactly three distinct,",
    "concrete follow-up prompts the user might click next. Each follow-up is",
    "a self-contained prompt of at most fifteen words, written in the user's voice.",
    "",
    "<prompt>",
    prompt,
    "</prompt>",
    "",
    "<response>",
    clippedResponse,
    "</response>",
  ].join("\n");
}

export type RawFollowups = z.infer<typeof FollowupsSchema>;

/**
 * Normalise the model's four flat strings into the shape the app stores.
 * `parsed` is null when the SDK had no structured payload to decode (an empty
 * body, or the whole output budget spent on reasoning tokens) — surface that
 * as a clear error rather than dereferencing null.
 */
export function toStructured(parsed: RawFollowups | null): {
  title: string;
  suggestions: [string, string, string];
} {
  if (!parsed) {
    throw new Error("The model returned no structured follow-ups payload");
  }
  return {
    title: parsed.title.trim(),
    suggestions: [
      parsed.suggestion1.trim(),
      parsed.suggestion2.trim(),
      parsed.suggestion3.trim(),
    ],
  };
}
