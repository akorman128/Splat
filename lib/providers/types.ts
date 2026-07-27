import "server-only";
import type { Provider } from "./models";

export type { Provider };

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "usage"; promptTokens: number | null; completionTokens: number | null };

export type StructuredFollowups = {
  title: string;
  suggestions: [string, string, string];
};

export interface ProviderAdapter {
  /** Round-trip the key against the provider's models endpoint. */
  verifyKey(apiKey: string): Promise<{ ok: true } | { ok: false; message: string }>;

  /** Streamed chat completion. Yields text deltas, then a usage event. */
  streamChat(opts: {
    apiKey: string;
    model: string;
    messages: ChatMessage[];
  }): AsyncGenerator<StreamEvent>;

  /**
   * Structured "title + exactly 3 follow-ups" call on the utility model.
   * Not streamed; strict schema; falls back one tier up (the conversation
   * model) if the utility model is unavailable, logging the substitution.
   *
   * `model` is the id the card itself was generated with. Providers with a
   * pinned model tier ignore it; catalogue providers use it as the fallback
   * target, since it is the one id this key is known to be able to reach.
   * For a catalogue provider that defaults to a meta-model, the meta-model is
   * still a valid fallback — routing to something that may not hold a schema
   * beats having no fallback for the default selection.
   */
  generateFollowups(opts: {
    apiKey: string;
    prompt: string;
    response: string;
    model?: string;
  }): Promise<StructuredFollowups>;
}
