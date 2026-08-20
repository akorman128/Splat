
export const PROVIDERS = ["openai", "anthropic", "openrouter"] as const;
export type Provider = (typeof PROVIDERS)[number];

export type ModelRole = "conversation" | "utility";

export const OPENROUTER_AUTO = "openrouter/auto";

export const MAX_OUTPUT_TOKENS = 32000;

export const MODELS: Record<Provider, Record<ModelRole, string>> = {
  openai: {
    conversation: "gpt-5.6-sol",
    utility: "gpt-5.6-luna",
  },
  anthropic: {
    conversation: "claude-opus-5",
    utility: "claude-haiku-4-5",
  },
  openrouter: {
    conversation: OPENROUTER_AUTO,
    utility: "google/gemini-2.5-flash-lite",
  },
};

export const PROVIDER_LABELS: Record<Provider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
};

export const PROVIDER_KEY_URLS: Record<Provider, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://platform.claude.com/settings/workspaces/default/keys",
  openrouter: "https://openrouter.ai/settings/keys",
};

export function defaultModel(provider: Provider): string {
  return MODELS[provider].conversation;
}

export type CatalogModel = {
  id: string;
  name: string;
  contextLength: number | null;
  maxOutputTokens: number | null;
  promptPrice: number | null;
  completionPrice: number | null;
  // From the catalogue's declared input modalities. A text-only model handed an
  // image answers with a 400, so this is worth checking before we send. It is
  // advisory for openrouter/auto, which reports the union of everything it
  // might route to.
  supportsImages: boolean;
  // Whether the provider will run a web search for this model. False hides the
  // toggle rather than letting a send fail; only OpenRouter publishes enough to
  // ever say no, since its server tool needs a model that can call tools.
  supportsWebSearch: boolean;
  // Release date, epoch millis. Which dated web search tool a model takes
  // follows from when it shipped, so this is read rather than guessed at from
  // the wording of a rejection.
  releasedAt: number | null;
};

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}
