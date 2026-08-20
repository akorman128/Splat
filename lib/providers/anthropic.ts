import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MAX_OUTPUT_TOKENS, MODELS } from "./models";
import { catalogEntry } from "./catalog";
import { FollowupsSchema, followupsPrompt, toStructured } from "./followups";
import { MAX_WEB_SEARCHES } from "./web-search";
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

// Adaptive rather than a budget_tokens config, which is a 400 from Opus 4.7
// onwards; on the older models still in the picker, effort is a 400 of its own.
function thinkingParams(level: ThinkingLevel | null): ThinkingParams {
  if (!level) return {};
  if (level === "off") return { thinking: { type: "disabled" } };
  return { thinking: { type: "adaptive" }, output_config: { effort: level } };
}

// The dated tool types are per-model: the newer one filters results before they
// reach the context window, and is a 400 on anything older than Opus 4.6. The
// picker lists every model the key can reach, so the older type is the fallback
// rather than a second choice we could make up front.
const WEB_SEARCH_TYPES = ["web_search_20260209", "web_search_20250305"] as const;

type WebSearchType = (typeof WEB_SEARCH_TYPES)[number];

function webSearchTool(type: WebSearchType): Anthropic.ToolUnion {
  return { type, name: "web_search", max_uses: MAX_WEB_SEARCHES };
}

// The wording varies, but a rejected tool type always names itself.
function rejectsToolType(err: unknown, type: WebSearchType): boolean {
  return err instanceof Anthropic.BadRequestError && err.message.includes(type);
}

// A server-side search loop that hits its own iteration limit stops with
// pause_turn and resumes when the paused assistant turn is sent back — no extra
// user message, which the API would read as a new instruction.
const MAX_PAUSED_TURNS = 4;

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

type ChatParams = Omit<
  Anthropic.MessageCreateParamsStreaming,
  "messages" | "stream" | "tools"
>;

// Usage is summed rather than read off the last message: a resumed turn bills
// each leg separately, and the card shows what the answer cost in total.
async function* runChat(
  apiKey: string,
  params: ChatParams,
  messages: Anthropic.MessageParam[],
  tools?: Anthropic.ToolUnion[],
): AsyncGenerator<StreamEvent> {
  const history = [...messages];
  // Null until a leg reports one, so a card whose counts never arrived still
  // falls back to the estimate rather than showing a confident zero.
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;

  for (let turn = 0; ; turn++) {
    const stream = client(apiKey).messages.stream({
      ...params,
      messages: history,
      ...(tools ? { tools } : {}),
    });

    for await (const event of stream) {
      if (event.type !== "content_block_delta") continue;
      if (event.delta.type === "text_delta") {
        yield { type: "delta", text: event.delta.text };
      } else if (
        event.delta.type === "citations_delta" &&
        event.delta.citation.type === "web_search_result_location"
      ) {
        yield {
          type: "citation",
          title: event.delta.citation.title,
          url: event.delta.citation.url,
        };
      }
    }

    const final = await stream.finalMessage();
    if (final.usage.input_tokens != null) {
      promptTokens = (promptTokens ?? 0) + final.usage.input_tokens;
    }
    if (final.usage.output_tokens != null) {
      completionTokens = (completionTokens ?? 0) + final.usage.output_tokens;
    }

    if (final.stop_reason === "pause_turn") {
      if (turn >= MAX_PAUSED_TURNS) {
        throw new Error(
          "Anthropic paused this response more times than Splat will resume it. Narrow the prompt, or turn web search off.",
        );
      }
      history.push({ role: "assistant", content: final.content });
      continue;
    }

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
        throw new Error(`Anthropic response incomplete: ${final.stop_reason}.`);
    }

    yield { type: "usage", promptTokens, completionTokens };
    return;
  }
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
    webSearch,
  }): AsyncGenerator<StreamEvent> {
    const params = {
      model,
      max_tokens: await outputBudget(apiKey, model),
      ...(system ? { system } : {}),
      ...thinkingParams(thinking ?? null),
    };

    if (!webSearch) {
      yield* runChat(apiKey, params, toAnthropic(messages));
      return;
    }

    // Nothing has been yielded when a tool type is rejected — the 400 lands on
    // the first read of the stream — so the older type gets a clean run at it.
    let started = false;
    for (const [index, type] of WEB_SEARCH_TYPES.entries()) {
      const last = index === WEB_SEARCH_TYPES.length - 1;
      try {
        for await (const event of runChat(apiKey, params, toAnthropic(messages), [
          webSearchTool(type),
        ])) {
          started = true;
          yield event;
        }
        return;
      } catch (err) {
        if (started || !rejectsToolType(err, type)) throw err;
        if (last) {
          throw new Error(
            `${model} cannot search the web. Pick a newer model, or turn web search off.`,
          );
        }
        console.warn(
          `[providers/anthropic] ${model} rejected ${type}; retrying with ${WEB_SEARCH_TYPES[index + 1]}`,
        );
      }
    }
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
