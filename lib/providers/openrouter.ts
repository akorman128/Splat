import "server-only";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { MAX_OUTPUT_TOKENS, MODELS, OPENROUTER_AUTO } from "./models";
import { catalogEntry } from "./catalog";
import { FollowupsSchema, followupsPrompt, toStructured } from "./followups";
import type { ChatMessage, ProviderAdapter, StreamEvent } from "./types";

// OpenRouter speaks the OpenAI Chat Completions wire format, so this reuses
// the `openai` SDK against their base URL — the client-SDK route their
// quickstart recommends — rather than hand-rolling fetch calls.
//
// Unlike the other two adapters the model is not fixed: the user picks any id
// from the live catalogue (lib/providers/catalog.ts), and that id is stored on
// the node and passed back in here.
//
// Sampling params (temperature) are omitted, as in the other adapters: the
// catalogue spans reasoning models that reject or ignore non-default values.

const BASE_URL = "https://openrouter.ai/api/v1";

// Optional attribution headers. OpenRouter uses them to credit traffic to an
// app on its public leaderboards; they carry nothing sensitive and nothing
// breaks when they are unset.
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

// ~4 chars per token plus per-message framing. Deliberately an over-estimate:
// guessing high costs headroom, guessing low costs a 400.
function estimatePromptTokens(messages: ChatMessage[]): number {
  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  return Math.ceil(chars / 4) + messages.length * 8;
}

/**
 * max_tokens for one call, or undefined to let OpenRouter apply the model's own
 * default. Unlike a pinned-model adapter this cannot hard-code a budget: the
 * catalogue spans models that cap output far below MAX_OUTPUT_TOKENS and models
 * whose whole context is smaller, and OpenRouter 400s a max_tokens above
 * either. Every known limit therefore applies at once — a declared output cap
 * does not exempt a model from its context window, which the prompt shares.
 */
async function outputBudget(
  model: string,
  messages: ChatMessage[],
): Promise<number | undefined> {
  const entry = await catalogEntry("openrouter", model);
  // Unknown id, or the catalogue is unreachable. A guessed number is the one
  // thing that can turn a working model into a 400.
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
  // The prompt already fills the window: say nothing, and let OpenRouter return
  // an error that counts tokens properly and names the real limit.
  return budget >= MIN_OUTPUT_TOKENS ? budget : undefined;
}

// Only these mean the model actually finished. Anything else throws so the
// route persists the partial as status:"error" with a Retry button — letting a
// truncated answer through as "complete" offers no Retry and then feeds the
// cut-off text verbatim as context into every child prompt. The non-OpenAI
// spellings are here because OpenRouter fronts dozens of upstreams and does not
// normalise every one of them.
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
  if (finishReason === null) return; // no terminal chunk seen
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

/**
 * OpenRouter can report a mid-stream failure as an `error` member on an
 * otherwise ordinary chunk. The SDK throws on a top-level one, but not on a
 * per-choice one — and an unhandled one just ends the loop with no
 * finish_reason, storing a truncated answer as "complete".
 */
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
    // Deliberately NOT models.list(): OpenRouter's catalogue endpoint is
    // public and answers 200 for a garbage key, so it would wave through
    // every string. /api/v1/key is the authenticated round trip — it returns
    // the key's own limits, and 401s when the key is not real.
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
      // Without this OpenRouter streams no usage block at all and every card
      // would persist null token counts.
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
      // Arrives on the final chunk, which carries an empty choices array.
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
    // chat.completions.parse (not .create) so the SDK decodes and validates
    // into message.parsed, matching the other adapters — a bare JSON.parse
    // surfaces a truncated body as an opaque SyntaxError.
    const messages: ChatMessage[] = [
      { role: "user", content: followupsPrompt(prompt, response) },
    ];
    // The fallback target is a user-chosen catalogue model, so even this small
    // budget has to fit inside whatever that model accepts.
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

/**
 * The card's own model: the one id this key demonstrably reaches. Includes
 * openrouter/auto — it routes per request so it carries no structured-output
 * guarantee, but it is the default conversation model, and a fallback that
 * might work beats no follow-ups at all for the most common card there is.
 */
function followupsFallback(model: string | undefined): string | null {
  const fallback = model ?? OPENROUTER_AUTO;
  return fallback === MODELS.openrouter.utility ? null : fallback;
}

// OpenRouter answers an id it does not serve with a 400, not a 404, so a bare
// `instanceof BadRequestError` would also swallow schema and parameter errors
// — and retrying one of those just bills a second identical failure. Match the
// phrasings that actually mean "no such model", not any mention of the word.
const MODEL_UNAVAILABLE_PATTERNS = [
  /model[_ ]not[_ ]found/i,
  /no (?:endpoints?|allowed providers?)[^.]*found/i,
  /not a valid model/i,
  /(?:unknown|invalid|unsupported) model/i,
  /does not exist or you do not have access/i,
];

function isModelUnavailable(err: unknown): boolean {
  if (err instanceof OpenAI.NotFoundError) return true;
  if (!(err instanceof OpenAI.BadRequestError)) return false;
  if (err.code === "model_not_found") return true;
  return MODEL_UNAVAILABLE_PATTERNS.some((pattern) =>
    pattern.test(err.message),
  );
}
