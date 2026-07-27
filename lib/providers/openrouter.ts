import "server-only";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { MODELS, defaultModel } from "./models";
import { FollowupsSchema, followupsPrompt, toStructured } from "./followups";
import type { ProviderAdapter, StreamEvent } from "./types";

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

/**
 * OpenRouter can report a mid-stream failure as an `error` member on an
 * otherwise ordinary chunk — the SDK has no type for it and does not throw,
 * so an unhandled one would end the loop early and store a truncated answer
 * as "complete".
 */
type MaybeErrorChunk = {
  error?: { message?: string; code?: string | number } | null;
};

function streamErrorMessage(chunk: MaybeErrorChunk): string | null {
  if (!chunk.error) return null;
  const { message, code } = chunk.error;
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
      max_tokens: 32000,
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

    // Same contract as the other two adapters: only a genuine finish may fall
    // through. Anything else has to throw so the route persists the partial as
    // status:"error" with a Retry button — letting a truncated answer through
    // as "complete" would offer no Retry and then feed the cut-off text
    // verbatim as context into every child prompt.
    switch (finishReason) {
      case "stop":
      case null: // no terminal chunk seen — nothing to report
        break;
      case "length":
        throw new Error(
          "OpenRouter response incomplete: hit the max_tokens limit.",
        );
      case "content_filter":
        throw new Error("The model declined this request (content filter).");
      case "error":
        throw new Error("OpenRouter reported a failed response.");
      default:
        throw new Error(`OpenRouter response incomplete: ${finishReason}.`);
    }

    yield { type: "usage", ...usage };
  },

  async generateFollowups({ apiKey, prompt, response, model }) {
    // chat.completions.parse (not .create) so the SDK decodes and validates
    // into message.parsed, matching the other adapters — a bare JSON.parse
    // surfaces a truncated body as an opaque SyntaxError.
    const call = async (target: string) => {
      const res = await client(apiKey).chat.completions.parse({
        model: target,
        messages: [
          { role: "user", content: followupsPrompt(prompt, response) },
        ],
        response_format: zodResponseFormat(FollowupsSchema, "followups"),
        max_tokens: 2000,
      });
      return toStructured(res.choices[0]?.message.parsed ?? null);
    };

    try {
      return await call(MODELS.openrouter.utility);
    } catch (err) {
      // OpenRouter answers an id it does not serve with a 400, not a 404 —
      // and a model can also be absent for this account specifically. Either
      // way, fall back to the model that produced the card, which is known to
      // work for this key.
      const unavailable =
        err instanceof OpenAI.NotFoundError ||
        err instanceof OpenAI.BadRequestError;
      const fallback = model ?? defaultModel("openrouter");
      if (unavailable && fallback !== MODELS.openrouter.utility) {
        console.warn(
          `[providers/openrouter] utility model ${MODELS.openrouter.utility} unavailable; falling back to ${fallback}`,
        );
        return await call(fallback);
      }
      throw err;
    }
  },
};
