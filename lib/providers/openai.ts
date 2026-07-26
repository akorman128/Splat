import "server-only";
import OpenAI from "openai";
import { MODELS } from "./models";
import {
  FOLLOWUPS_SCHEMA,
  followupsPrompt,
  toStructured,
  type RawFollowups,
} from "./followups";
import type { ProviderAdapter, StreamEvent } from "./types";

// GPT-5.6-series models are served via the Responses API.
// Sampling params (temperature) are omitted throughout: current reasoning
// models reject or ignore non-default values.

function client(apiKey: string): OpenAI {
  return new OpenAI({ apiKey });
}

export const openaiAdapter: ProviderAdapter = {
  async verifyKey(apiKey) {
    try {
      await client(apiKey).models.list();
      return { ok: true };
    } catch (err) {
      if (err instanceof OpenAI.AuthenticationError) {
        return { ok: false, message: "OpenAI rejected this API key." };
      }
      return {
        ok: false,
        message: `Could not verify key with OpenAI: ${err instanceof Error ? err.message : "unknown error"}`,
      };
    }
  },

  async *streamChat({ apiKey, model, messages }): AsyncGenerator<StreamEvent> {
    const stream = await client(apiKey).responses.create({
      model,
      input: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      max_output_tokens: 32000,
    });

    let usage: { promptTokens: number | null; completionTokens: number | null } = {
      promptTokens: null,
      completionTokens: null,
    };

    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        yield { type: "delta", text: event.delta };
      } else if (event.type === "response.completed") {
        usage = {
          promptTokens: event.response.usage?.input_tokens ?? null,
          completionTokens: event.response.usage?.output_tokens ?? null,
        };
      } else if (event.type === "response.failed") {
        throw new Error(
          event.response.error?.message ?? "OpenAI reported a failed response",
        );
      } else if (event.type === "response.incomplete") {
        // Keep whatever streamed; surface the cause.
        throw new Error(
          `OpenAI response incomplete: ${event.response.incomplete_details?.reason ?? "unknown reason"}`,
        );
      }
    }

    yield { type: "usage", ...usage };
  },

  async generateFollowups({ apiKey, prompt, response }) {
    const call = async (model: string) => {
      const res = await client(apiKey).responses.create({
        model,
        input: [{ role: "user", content: followupsPrompt(prompt, response) }],
        text: {
          format: {
            type: "json_schema",
            name: "followups",
            strict: true,
            schema: FOLLOWUPS_SCHEMA as unknown as Record<string, unknown>,
          },
        },
        // Low output budget per spec — enough headroom for reasoning tokens.
        max_output_tokens: 2000,
      });
      return toStructured(JSON.parse(res.output_text) as RawFollowups);
    };

    try {
      return await call(MODELS.openai.utility);
    } catch (err) {
      if (err instanceof OpenAI.NotFoundError) {
        // Utility model unavailable on this account — fall back one tier up.
        console.warn(
          `[providers/openai] utility model ${MODELS.openai.utility} unavailable; falling back to ${MODELS.openai.conversation}`,
        );
        return await call(MODELS.openai.conversation);
      }
      throw err;
    }
  },
};
