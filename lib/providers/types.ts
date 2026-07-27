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
  verifyKey(apiKey: string): Promise<{ ok: true } | { ok: false; message: string }>;

  streamChat(opts: {
    apiKey: string;
    model: string;
    messages: ChatMessage[];
  }): AsyncGenerator<StreamEvent>;

  generateFollowups(opts: {
    apiKey: string;
    prompt: string;
    response: string;
    model?: string;
  }): Promise<StructuredFollowups>;
}
