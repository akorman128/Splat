import type { Provider } from "@/lib/providers/models";

export const queryKeys = {
  models: (provider: Provider) => ["models", provider] as const,
  suggestions: (nodeId: string) => ["suggestions", nodeId] as const,
  attachmentUrls: (ids: string[]) => ["attachment-urls", ids.join(",")] as const,
};
