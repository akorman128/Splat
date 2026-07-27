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
    // A *default*, not the only allowed value: OpenRouter is a catalogue
    // provider (see CATALOG_PROVIDERS), so the user picks any id from the
    // live list. openrouter/auto lets OpenRouter route each prompt itself,
    // which is the least opinionated thing to preselect.
    conversation: "openrouter/auto",
    // Fixed regardless of which conversation model the user picked: one
    // OpenRouter key reaches every model, and follow-ups need dependable
    // json_schema adherence on a cheap tier. Picked off the catalogue's
    // supported_parameters (it advertises structured_outputs) and verified
    // end-to-end. Reasoning-heavy nano models were rejected — they spend the
    // whole output budget thinking and return an empty payload.
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
  openrouter: "https://openrouter.ai/workspaces/default/keys",
};

/**
 * Providers whose conversation model is chosen from a live catalogue instead
 * of being pinned in MODELS. Request validation, the composer's picker and
 * the model label all branch on this rather than on the literal "openrouter",
 * so adding a second aggregator stays a one-line change here.
 */
export const CATALOG_PROVIDERS: readonly Provider[] = ["openrouter"];

export function hasModelCatalog(provider: Provider): boolean {
  return CATALOG_PROVIDERS.includes(provider);
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
  /** USD per token. null when the provider prices the model dynamically. */
  promptPrice: number | null;
  completionPrice: number | null;
};

export function conversationModelLabel(
  provider: Provider,
  model?: string | null,
): string {
  return `${PROVIDER_LABELS[provider]} · ${model || defaultModel(provider)}`;
}

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}
