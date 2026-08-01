import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { MAX_OUTPUT_TOKENS, MODELS } from "./models";
import { FollowupsSchema, followupsPrompt, toStructured } from "./followups";
import type { ChatMessage, ProviderAdapter, StreamEvent } from "./types";

function client(apiKey: string): OpenAI {
  return new OpenAI({ apiKey });
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
  }): AsyncGenerator<StreamEvent> {
    const stream = await client(apiKey).responses.create({
      model,
      input: toResponsesInput(messages),
      stream: true,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      ...(system ? { instructions: system } : {}),
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

  async generateFollowups({ apiKey, prompt, response }) {
    const call = async (model: string) => {
      const res = await client(apiKey).responses.parse({
        model,
        input: [{ role: "user", content: followupsPrompt(prompt, response) }],
        text: { format: zodTextFormat(FollowupsSchema, "followups") },
        max_output_tokens: 2000,
      });
      return toStructured(res.output_parsed);
    };

    try {
      return await call(MODELS.openai.utility);
    } catch (err) {
      if (err instanceof OpenAI.NotFoundError) {
        console.warn(
          `[providers/openai] utility model ${MODELS.openai.utility} unavailable; falling back to ${MODELS.openai.conversation}`,
        );
        return await call(MODELS.openai.conversation);
      }
      throw err;
    }
  },
};
