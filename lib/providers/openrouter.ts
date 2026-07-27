import "server-only";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { MAX_OUTPUT_TOKENS, MODELS, OPENROUTER_AUTO } from "./models";
import { catalogEntry } from "./catalog";
import { FollowupsSchema, followupsPrompt, toStructured } from "./followups";
import type { ChatMessage, ProviderAdapter, StreamEvent } from "./types";

const BASE_URL = "https://openrouter.ai/api/v1";

function attributionHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const siteUrl = process.env.OPENROUTER_SITE_URL;
  const siteName = process.env.OPENROUTER_SITE_NAME ?? "Splat";
  if (siteUrl) headers["HTTP-Referer"] = siteUrl;
  if (siteName) headers["X-Title"] = siteName;
  return headers;
}

function client(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: BASE_URL,
    defaultHeaders: attributionHeaders(),
  });
}

const OUTPUT_RESERVE_TOKENS = 512;
const MIN_OUTPUT_TOKENS = 256;
const FOLLOWUPS_MAX_TOKENS = 2000;

function estimatePromptTokens(messages: ChatMessage[]): number {
  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  return Math.ceil(chars / 4) + messages.length * 8;
}

async function outputBudget(
  model: string,
  messages: ChatMessage[],
): Promise<number | undefined> {
  const entry = await catalogEntry("openrouter", model);
  if (!entry) return undefined;

  let budget = MAX_OUTPUT_TOKENS;
  if (entry.maxOutputTokens) {
    budget = Math.min(budget, entry.maxOutputTokens);
  }
  if (entry.contextLength) {
    const room =
      entry.contextLength -
      estimatePromptTokens(messages) -
      OUTPUT_RESERVE_TOKENS;
    budget = Math.min(budget, room);
  }
  return budget >= MIN_OUTPUT_TOKENS ? budget : undefined;
}

const COMPLETE_FINISH_REASONS = new Set([
  "stop",
  "tool_calls",
  "end_turn",
  "stop_sequence",
  "eos",
  "complete",
]);
const TRUNCATING_FINISH_REASONS = new Set([
  "length",
  "max_tokens",
  "model_length",
  "max_output_tokens",
  "context_length_exceeded",
]);
const REFUSAL_FINISH_REASONS = new Set([
  "content_filter",
  "refusal",
  "safety",
  "recitation",
  "blocklist",
  "prohibited_content",
  "spii",
]);

function assertWholeResponse(finishReason: string | null): void {
  if (finishReason === null) return;
  const reason = finishReason.toLowerCase();
  if (COMPLETE_FINISH_REASONS.has(reason)) return;
  if (TRUNCATING_FINISH_REASONS.has(reason)) {
    throw new Error(
      "OpenRouter response incomplete: hit the output token limit.",
    );
  }
  if (REFUSAL_FINISH_REASONS.has(reason)) {
    throw new Error("The model declined this request (content filter).");
  }
  if (reason === "error") {
    throw new Error("OpenRouter reported a failed response.");
  }
  throw new Error(`OpenRouter response incomplete: ${finishReason}.`);
}

type ChunkError = { message?: string; code?: string | number } | null;

type MaybeErrorChunk = {
  error?: ChunkError;
  choices?: ({ error?: ChunkError } | null)[];
};

function streamErrorMessage(chunk: MaybeErrorChunk): string | null {
  const error = chunk.error ?? chunk.choices?.[0]?.error;
  if (!error) return null;
  const { message, code } = error;
  return `OpenRouter reported an error mid-stream${code ? ` (${code})` : ""}: ${
    message ?? "no detail given"
  }`;
}

export const openrouterAdapter: ProviderAdapter = {
  async verifyKey(apiKey) {
    try {
      const res = await fetch(`${BASE_URL}/key`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: "OpenRouter rejected this API key." };
      }
      if (!res.ok) {
        return {
          ok: false,
          message: `Could not verify key with OpenRouter (HTTP ${res.status}).`,
        };
      }
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        message: `Could not verify key with OpenRouter: ${err instanceof Error ? err.message : "unknown error"}`,
      };
    }
  },

  async *streamChat({ apiKey, model, messages }): AsyncGenerator<StreamEvent> {
    const stream = await client(apiKey).chat.completions.create({
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: await outputBudget(model, messages),
    });

    let usage: { promptTokens: number | null; completionTokens: number | null } = {
      promptTokens: null,
      completionTokens: null,
    };
    let finishReason: string | null = null;

    for await (const chunk of stream) {
      const errorMessage = streamErrorMessage(chunk as MaybeErrorChunk);
      if (errorMessage) throw new Error(errorMessage);

      const choice = chunk.choices?.[0];
      if (choice?.delta?.content) {
        yield { type: "delta", text: choice.delta.content };
      }
      if (choice?.finish_reason) {
        finishReason = choice.finish_reason;
      }
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens ?? null,
          completionTokens: chunk.usage.completion_tokens ?? null,
        };
      }
    }

    assertWholeResponse(finishReason);

    yield { type: "usage", ...usage };
  },

  async generateFollowups({ apiKey, prompt, response, model }) {
    const messages: ChatMessage[] = [
      { role: "user", content: followupsPrompt(prompt, response) },
    ];
    const call = async (target: string) => {
      const budget = await outputBudget(target, messages);
      const res = await client(apiKey).chat.completions.parse({
        model: target,
        messages,
        response_format: zodResponseFormat(FollowupsSchema, "followups"),
        max_tokens: Math.min(
          FOLLOWUPS_MAX_TOKENS,
          budget ?? FOLLOWUPS_MAX_TOKENS,
        ),
      });
      return toStructured(res.choices[0]?.message.parsed ?? null);
    };

    try {
      return await call(MODELS.openrouter.utility);
    } catch (err) {
      const fallback = followupsFallback(model);
      if (fallback && isModelUnavailable(err)) {
        console.warn(
          `[providers/openrouter] utility model ${MODELS.openrouter.utility} unavailable; falling back to ${fallback}`,
        );
        return await call(fallback);
      }
      throw err;
    }
  },
};

function followupsFallback(model: string | undefined): string | null {
  const fallback = model ?? OPENROUTER_AUTO;
  return fallback === MODELS.openrouter.utility ? null : fallback;
}

const MODEL_UNAVAILABLE_PATTERNS = [
  /model[_ ]not[_ ]found/i,
  /no (?:endpoints?|allowed providers?)\b/i,
  /not a valid model/i,
  /(?:unknown|invalid|unsupported) model/i,
  /does not exist or you do not have access/i,
];

// OpenRouter answers an id it does not serve with a 400, not a 404, and the
// wording varies by account and by routing rule — so any 400 is worth one
// retry on the card's own model, and the patterns catch the other statuses.
function isModelUnavailable(err: unknown): boolean {
  if (err instanceof OpenAI.NotFoundError) return true;
  if (err instanceof OpenAI.BadRequestError) return true;
  return (
    err instanceof Error &&
    MODEL_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(err.message))
  );
}
