import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MAX_OUTPUT_TOKENS, MODELS } from "./models";
import { catalogEntry } from "./catalog";
import { FollowupsSchema, followupsPrompt, toStructured } from "./followups";
import type { ThinkingLevel } from "./thinking";
import type { ChatMessage, ProviderAdapter, StreamEvent } from "./types";

function client(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

// max_tokens is required and every model has its own ceiling, so asking for our
// own limit is a 400 on any model whose ceiling is lower. A catalogue we could
// not reach leaves the limit where it was.
async function outputBudget(apiKey: string, model: string): Promise<number> {
  const entry = await catalogEntry("anthropic", model, apiKey);
  if (!entry?.maxOutputTokens) return MAX_OUTPUT_TOKENS;
  return Math.min(MAX_OUTPUT_TOKENS, entry.maxOutputTokens);
}

type ThinkingParams = {
  thinking?: Anthropic.ThinkingConfigParam;
  output_config?: Anthropic.OutputConfig;
};

// Adaptive thinking with an effort hint is the shape current Claude models take
// — a budget_tokens thinking config is a 400 from Opus 4.7 onwards. Asking for
// nothing sends neither field, which is what keeps the older models in the
// picker reachable: effort is a 400 of its own there.
function thinkingParams(level: ThinkingLevel | null): ThinkingParams {
  if (!level) return {};
  if (level === "off") return { thinking: { type: "disabled" } };
  return { thinking: { type: "adaptive" }, output_config: { effort: level } };
}

function toAnthropic(messages: ChatMessage[]): Anthropic.MessageParam[] {
  return messages.map((message): Anthropic.MessageParam => {
    if (message.role === "assistant") {
      return { role: "assistant", content: message.content };
    }
    if (typeof message.content === "string") {
      return { role: "user", content: message.content };
    }
    return {
      role: "user",
      content: message.content.map((part) => {
        if (part.type === "text") {
          return { type: "text" as const, text: part.text };
        }
        if (part.type === "document") {
          return {
            type: "document" as const,
            source: {
              type: "base64" as const,
              media_type: "application/pdf" as const,
              data: part.data,
            },
            title: part.filename,
          };
        }
        return {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: part.mediaType,
            data: part.data,
          },
        };
      }),
    };
  });
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

  async *streamChat({
    apiKey,
    model,
    messages,
    system,
    thinking,
  }): AsyncGenerator<StreamEvent> {
    const stream = client(apiKey).messages.stream({
      model,
      max_tokens: await outputBudget(apiKey, model),
      messages: toAnthropic(messages),
      ...(system ? { system } : {}),
      ...thinkingParams(thinking ?? null),
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

    switch (final.stop_reason) {
      case "end_turn":
      case "stop_sequence":
      case null:
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

  async generateFollowups({ apiKey, prompt, response, model }) {
    const call = async (target: string) => {
      const res = await client(apiKey).messages.parse({
        model: target,
        max_tokens: 1000,
        output_config: { format: zodOutputFormat(FollowupsSchema) },
        messages: [
          { role: "user", content: followupsPrompt(prompt, response) },
        ],
      });
      return toStructured(res.parsed_output);
    };

    try {
      return await call(MODELS.anthropic.utility);
    } catch (err) {
      // The card's own model, unless that is the one that just failed.
      const fallback =
        model && model !== MODELS.anthropic.utility
          ? model
          : MODELS.anthropic.conversation;
      if (err instanceof Anthropic.NotFoundError) {
        console.warn(
          `[providers/anthropic] utility model ${MODELS.anthropic.utility} unavailable; falling back to ${fallback}`,
        );
        return await call(fallback);
      }
      throw err;
    }
  },
};
