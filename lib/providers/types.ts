import "server-only";
import type { Provider } from "./models";
import type { ThinkingLevel } from "./thinking";
import type { Citation } from "./web-search";

export type { Provider };

// Deliberately the exact union from Anthropic's Base64ImageSource.media_type.
// Every adapter has to accept whatever this allows, so an image format one of
// them cannot take is a compile error here rather than a 400 at send time.
export type ImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

export type ContentPart =
  | { type: "text"; text: string }
  // base64, with no data: prefix — each adapter adds whatever wrapper its API
  // expects. Dimensions ride along because pricing an image needs them and the
  // base64 length says nothing about it; null when they were never extracted.
  | {
      type: "image";
      mediaType: ImageMediaType;
      data: string;
      width: number | null;
      height: number | null;
    }
  // A whole PDF, base64, for files no text could be extracted from — the model
  // reads the pages itself. estTokens rides along for the same reason an image's
  // dimensions do: the byte length says nothing about what the pages cost.
  | { type: "document"; data: string; filename: string; estTokens: number };

// Discriminated on role: an image block in an assistant turn is a 400 from
// Anthropic, silently dropped by OpenRouter and passed through by OpenAI, so
// only user turns can carry parts and the three adapters cannot disagree.
export type ChatMessage =
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string };

export type StreamEvent =
  | { type: "delta"; text: string }
  // A source the model actually cited, not everything the search turned up.
  // Emitted before the usage event, in the order the answer cited them.
  | { type: "citation"; title: string | null; url: string }
  | { type: "usage"; promptTokens: number | null; completionTokens: number | null };

export type StructuredFollowups = {
  title: string;
  suggestions: [string, string, string];
};

export interface ProviderAdapter {
  verifyKey(apiKey: string): Promise<{ ok: true } | { ok: false; message: string }>;

  streamChat(opts: {
    apiKey: string;
    model: string;
    messages: ChatMessage[];
    system?: string;
    thinking?: ThinkingLevel | null;
    webSearch?: boolean;
    // Aborting tears the provider request down; the adapter surfaces it as a
    // thrown error, and the caller supplies the reason it wants to see.
    signal?: AbortSignal;
  }): AsyncGenerator<StreamEvent>;

  generateFollowups(opts: {
    apiKey: string;
    prompt: string;
    response: string;
    model?: string;
  }): Promise<StructuredFollowups>;

  // A reader's question about one highlighted passage. Answered on the same
  // utility model the follow-ups use — the fastest one the provider has — and
  // in one shot rather than a stream, because the answer is a paragraph read
  // in a popover, not a card.
  //
  // Always with the provider's web search tool, unlike a card, where searching
  // is the sender's toggle: what a reader asks about a passage is as often
  // whether it is still true as what it means, and the card the passage came
  // from cannot be asked again. The model decides whether to use it, so a
  // question the passage already answers costs nothing but the tool definition.
  answerHighlight(opts: {
    apiKey: string;
    system: string;
    prompt: string;
    model?: string;
  }): Promise<{ answer: string; model: string; citations: Citation[] }>;
}
