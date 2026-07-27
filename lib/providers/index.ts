import "server-only";
import { openaiAdapter } from "./openai";
import { anthropicAdapter } from "./anthropic";
import { openrouterAdapter } from "./openrouter";
import type { Provider } from "./models";
import type { ProviderAdapter } from "./types";

const adapters: Record<Provider, ProviderAdapter> = {
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  openrouter: openrouterAdapter,
};

export function getAdapter(provider: Provider): ProviderAdapter {
  return adapters[provider];
}
