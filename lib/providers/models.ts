// Model role map — the ONLY place model ids live. Client-safe (no SDK imports,
// no secrets): the composer reads it to build the model dropdown.
//
// Ids confirmed against provider docs on 2026-07-25:
// - OpenAI GPT-5.6 series (developers.openai.com/api/docs/models)
// - Anthropic Claude 5 family (platform.claude.com docs)

export const PROVIDERS = ["openai", "anthropic"] as const;
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
};

export const PROVIDER_LABELS: Record<Provider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
};

export function conversationModelLabel(provider: Provider): string {
  return `${PROVIDER_LABELS[provider]} · ${MODELS[provider].conversation}`;
}

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}
