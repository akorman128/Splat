// Model role map — the ONLY place model ids live. Client-safe (no SDK imports,
// no secrets): the composer reads it for the provider list, each provider's
// label, and the model it starts on. It is not a dropdown of models —
// pinned providers have exactly one conversation model, and a catalogue
// provider's choices come from /api/models, not from here.
//
// Ids confirmed against provider docs on 2026-07-25:
// - OpenAI GPT-5.6 series (developers.openai.com/api/docs/models)
// - Anthropic Claude 5 family (platform.claude.com docs)
// OpenRouter ids confirmed against its live catalogue on 2026-07-26.

export const PROVIDERS = ["openai", "anthropic", "openrouter"] as const;
export type Provider = (typeof PROVIDERS)[number];

export type ModelRole = "conversation" | "utility";

/**
 * OpenRouter's meta-model: it picks a real model per request. It is the default
 * conversation model, so it is also the last-resort follow-ups fallback — a
 * routed model that may not hold a json_schema still beats no fallback at all.
 */
export const OPENROUTER_AUTO = "openrouter/auto";

/**
 * App-wide ceiling on a single streamed response, shared by all three adapters
 * so the cap cannot drift per provider. Catalogue models are additionally
 * bounded by their own limits (see lib/providers/openrouter.ts).
 */
export const MAX_OUTPUT_TOKENS = 32000;

export const MODELS: Record<Provider, Record<ModelRole, string>> = {
  openai: {
    // Flagship conversation model, streamed.
    conversation: "gpt-5.6-sol",
    // Smallest model that reliably holds a JSON schema.
    utility: "gpt-5.6-luna",
  },
  anthropic: {
    conversation: "claude-opus-5",
    utility: "claude-haiku-4-5",
  },
  openrouter: {
    // A default, not the only allowed value — the user picks any catalogue id.
    conversation: OPENROUTER_AUTO,
    // Fixed regardless of the conversation model: follow-ups need dependable
    // json_schema adherence on a cheap tier.
    utility: "google/gemini-2.5-flash-lite",
  },
};

export const PROVIDER_LABELS: Record<Provider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
};

/**
 * Where each provider issues API keys. Linked from the key form so "paste your
 * API key" has somewhere to go for a user who doesn't have one yet.
 */
export const PROVIDER_KEY_URLS: Record<Provider, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://platform.claude.com/settings/workspaces/default/keys",
  openrouter: "https://openrouter.ai/settings/keys",
};

/**
 * Providers whose conversation model is chosen from a live catalogue instead
 * of being pinned in MODELS. The composer, /api/models and /api/chat all
 * branch on hasModelCatalog() rather than on a literal id, so adding a
 * provider takes exactly two edits: this list, and a loader in the LOADERS
 * map in lib/providers/catalog.ts (the compiler flags the missing key).
 */
export const CATALOG_PROVIDERS = ["openrouter"] as const;
export type CatalogProvider = (typeof CATALOG_PROVIDERS)[number];

export function hasModelCatalog(
  provider: Provider,
): provider is CatalogProvider {
  return (CATALOG_PROVIDERS as readonly Provider[]).includes(provider);
}

/** The model a fresh composer selection starts on for this provider. */
export function defaultModel(provider: Provider): string {
  return MODELS[provider].conversation;
}

/**
 * One row of a provider's live model catalogue, normalised out of that
 * provider's own payload. Client-safe: this is what /api/models returns and
 * what the composer's picker renders.
 */
export type CatalogModel = {
  id: string;
  name: string;
  contextLength: number | null;
  /**
   * Most output tokens this model will accept a request for. null when the
   * catalogue does not say — callers must not assume a large budget.
   */
  maxOutputTokens: number | null;
  /** USD per token. null when the provider prices the model dynamically. */
  promptPrice: number | null;
  completionPrice: number | null;
};

export function conversationModelLabel(provider: Provider): string {
  return `${PROVIDER_LABELS[provider]} · ${defaultModel(provider)}`;
}

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}
