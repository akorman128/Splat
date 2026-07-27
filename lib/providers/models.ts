
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

export const CATALOG_PROVIDERS = ["openrouter"] as const;
export type CatalogProvider = (typeof CATALOG_PROVIDERS)[number];

export function hasModelCatalog(
  provider: Provider,
): provider is CatalogProvider {
  return (CATALOG_PROVIDERS as readonly Provider[]).includes(provider);
}

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
};

export function conversationModelLabel(provider: Provider): string {
  return `${PROVIDER_LABELS[provider]} · ${defaultModel(provider)}`;
}

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}
