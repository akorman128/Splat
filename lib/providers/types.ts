import "server-only";
import type { Provider } from "./models";

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
  // expects.
  | { type: "image"; mediaType: ImageMediaType; data: string };

// role stays un-discriminated so that `messages.push({ role: "assistant", … })`
// keeps working everywhere it already does; only user turns ever carry parts.
export type ChatMessage = {
  role: "user" | "assistant";
  content: string | ContentPart[];
};

export function messageText(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
}

export type StreamEvent =
  | { type: "delta"; text: string }
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
  }): AsyncGenerator<StreamEvent>;

  generateFollowups(opts: {
    apiKey: string;
    prompt: string;
    response: string;
    model?: string;
  }): Promise<StructuredFollowups>;
}
