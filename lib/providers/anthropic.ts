import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { MODELS } from "./models";
import {
  FOLLOWUPS_SCHEMA,
  followupsPrompt,
  toStructured,
  type RawFollowups,
} from "./followups";
import type { ProviderAdapter, StreamEvent } from "./types";

// Sampling params (temperature) are omitted throughout: Claude 4.7+ models
// reject them. Thinking config is likewise omitted — current models default
// to adaptive thinking where supported.

function client(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

export const anthropicAdapter: ProviderAdapter = {
  async verifyKey(apiKey) {
    try {
      await client(apiKey).models.list();
      return { ok: true };
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        return { ok: false, message: "Anthropic rejected this API key." };
      }
      return {
        ok: false,
        message: `Could not verify key with Anthropic: ${err instanceof Error ? err.message : "unknown error"}`,
      };
    }
  },

  async *streamChat({ apiKey, model, messages }): AsyncGenerator<StreamEvent> {
    const stream = client(apiKey).messages.stream({
      model,
      max_tokens: 32000,
      messages,
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield { type: "delta", text: event.delta.text };
      }
    }

    const final = await stream.finalMessage();

    // Only end_turn and stop_sequence mean the model actually finished. Every
    // other terminal reason has to throw so the route persists the partial as
    // status:"error" with a Retry button — the OpenAI adapter already does
    // this via response.incomplete. Letting max_tokens through would store a
    // mid-sentence answer as "complete", with no Retry offered and the
    // truncated text then fed verbatim as context into every child prompt.
    switch (final.stop_reason) {
      case "end_turn":
      case "stop_sequence":
      case null: // still streaming/unset — nothing to report
        break;
      case "refusal":
        throw new Error("The model declined this request (safety refusal).");
      case "max_tokens":
        throw new Error(
          "Anthropic response incomplete: hit the max_tokens limit.",
        );
      case "model_context_window_exceeded":
        throw new Error(
          "Anthropic response incomplete: the context window was exceeded.",
        );
      default:
        throw new Error(
          `Anthropic response incomplete: ${final.stop_reason}.`,
        );
    }

    yield {
      type: "usage",
      promptTokens: final.usage.input_tokens ?? null,
      completionTokens: final.usage.output_tokens ?? null,
    };
  },

  async generateFollowups({ apiKey, prompt, response }) {
    const call = async (model: string) => {
      const res = await client(apiKey).messages.create({
        model,
        max_tokens: 1000,
        output_config: {
          format: {
            type: "json_schema",
            schema: FOLLOWUPS_SCHEMA as unknown as Record<string, unknown>,
          },
        },
        messages: [
          { role: "user", content: followupsPrompt(prompt, response) },
        ],
      });
      const text = res.content.find((b) => b.type === "text")?.text;
      if (!text) {
        throw new Error("Anthropic returned no text for the followups call");
      }
      return toStructured(JSON.parse(text) as RawFollowups);
    };

    try {
      return await call(MODELS.anthropic.utility);
    } catch (err) {
      if (err instanceof Anthropic.NotFoundError) {
        // Utility model unavailable — fall back one tier up.
        console.warn(
          `[providers/anthropic] utility model ${MODELS.anthropic.utility} unavailable; falling back to ${MODELS.anthropic.conversation}`,
        );
        return await call(MODELS.anthropic.conversation);
      }
      throw err;
    }
  },
};
