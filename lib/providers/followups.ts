import "server-only";

// Shared schema + prompt for the structured "title + 3 suggestions" call.
// Three separate string properties (not an array with minItems/maxItems)
// because strict-mode schema support for array-length constraints differs
// between providers; three required fields guarantees exactly three.

export const FOLLOWUPS_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description:
        "A description of the gist of the user's prompt, six words maximum. Not a truncation of the prompt text.",
    },
    suggestion1: {
      type: "string",
      description: "A concrete follow-up prompt the user might ask next.",
    },
    suggestion2: {
      type: "string",
      description: "A second, distinct follow-up prompt.",
    },
    suggestion3: {
      type: "string",
      description: "A third, distinct follow-up prompt.",
    },
  },
  required: ["title", "suggestion1", "suggestion2", "suggestion3"],
  additionalProperties: false,
} as const;

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

export type RawFollowups = {
  title: string;
  suggestion1: string;
  suggestion2: string;
  suggestion3: string;
};

export function toStructured(raw: RawFollowups): {
  title: string;
  suggestions: [string, string, string];
} {
  return {
    title: raw.title.trim(),
    suggestions: [
      raw.suggestion1.trim(),
      raw.suggestion2.trim(),
      raw.suggestion3.trim(),
    ],
  };
}
