"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./api";
import { queryKeys } from "./keys";
import type { CatalogModel, Provider } from "@/lib/providers/models";

// Only the model dialog passes `enabled`: a reader that wants the list without
// asking for it — the composer, deciding whether this model can search — still
// gets what the dialog has cached, and still re-renders when the dialog fills
// it, but a composer nobody has opened the dialog on costs no provider call.
export function useModelCatalog(provider: Provider | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.models(provider),
    queryFn: async () => {
      const body = await apiFetch<{ models?: CatalogModel[] }>(
        `/api/models?provider=${provider}`,
      );
      if (!body.models) throw new Error("Could not load models");
      return body.models;
    },
    enabled: enabled && provider !== null,
    staleTime: Infinity,
  });
}

// Until the list loads there is nothing to hide the toggle on, and a model the
// list does not name is one the catalogue could not speak for — neither is a
// reason to take the control away.
export function modelSearchesWeb(
  models: CatalogModel[] | undefined,
  modelId: string | null,
): boolean {
  return models?.find((m) => m.id === modelId)?.supportsWebSearch ?? true;
}
