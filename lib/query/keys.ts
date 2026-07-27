import type { Provider } from "@/lib/providers/models";

export const queryKeys = {
  models: (provider: Provider) => ["models", provider] as const,
  suggestions: (nodeId: string) => ["suggestions", nodeId] as const,
};
