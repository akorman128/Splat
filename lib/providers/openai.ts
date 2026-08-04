import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { MODELS } from "./models";
import { FollowupsSchema, followupsPrompt, toStructured } from "./followups";
import type { ThinkingLevel } from "./thinking";
import type { ChatMessage, ProviderAdapter, StreamEvent } from "./types";

function client(apiKey: string): OpenAI {
  return new OpenAI({ apiKey });
}

// Sent only when a level was asked for: a model with no reasoning stage answers
// the parameter itself with a 400, and the picker lists those too.
function reasoningParams(
  level: ThinkingLevel | null,
): { reasoning?: OpenAI.Reasoning } {
  if (!level) return {};
  return { reasoning: { effort: level === "off" ? "none" : level } };
}

function toResponsesInput(
  messages: ChatMessage[],
): OpenAI.Responses.ResponseInput {
  return messages.map((message) => {
    if (message.role === "assistant") {
      return { role: "assistant" as const, content: message.content };
    }
    if (typeof message.content === "string") {
      return { role: "user" as const, content: message.content };
    }
    return {
      role: "user" as const,
      content: message.content.map((part) => {
        if (part.type === "text") {
          return { type: "input_text" as const, text: part.text };
        }
        if (part.type === "document") {
          return {
            type: "input_file" as const,
            filename: part.filename,
            file_data: `data:application/pdf;base64,${part.data}`,
          };
        }
        return {
          type: "input_image" as const,
          image_url: `data:${part.mediaType};base64,${part.data}`,
          detail: "auto" as const,
        };
      }),
    };
  });
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

  async *streamChat({
    apiKey,
    model,
    messages,
    system,
    thinking,
  }): AsyncGenerator<StreamEvent> {
    // No max_output_tokens: OpenAI's model list publishes no per-model ceiling,
    // and a fixed one is a 400 on every model whose own ceiling is lower than
    // ours. Left unset, each model stops at its own limit.
    const stream = await client(apiKey).responses.create({
      model,
      input: toResponsesInput(messages),
      stream: true,
      ...(system ? { instructions: system } : {}),
      ...reasoningParams(thinking ?? null),
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
        throw new Error(
          `OpenAI response incomplete: ${event.response.incomplete_details?.reason ?? "unknown reason"}`,
        );
      }
    }

    yield { type: "usage", ...usage };
  },

  async generateFollowups({ apiKey, prompt, response, model }) {
    const call = async (target: string) => {
      const res = await client(apiKey).responses.parse({
        model: target,
        input: [{ role: "user", content: followupsPrompt(prompt, response) }],
        text: { format: zodTextFormat(FollowupsSchema, "followups") },
        max_output_tokens: 2000,
      });
      return toStructured(res.output_parsed);
    };

    try {
      return await call(MODELS.openai.utility);
    } catch (err) {
      // The card's own model, unless that is the one that just failed.
      const fallback =
        model && model !== MODELS.openai.utility
          ? model
          : MODELS.openai.conversation;
      if (err instanceof OpenAI.NotFoundError) {
        console.warn(
          `[providers/openai] utility model ${MODELS.openai.utility} unavailable; falling back to ${fallback}`,
        );
        return await call(fallback);
      }
      throw err;
    }
  },
};
