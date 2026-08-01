"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, ChevronsUpDownIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/query/api";
import { queryKeys } from "@/lib/query/keys";
import { PROVIDER_LABELS, type CatalogModel, type Provider } from "@/lib/providers/models";
import { formatTokens } from "@/lib/tokens";

const MAX_ROWS = 80;

function formatLimits(model: CatalogModel): string | null {
  const parts: string[] = [];
  if (model.contextLength) parts.push(formatTokens(model.contextLength, "ctx"));
  if (model.maxOutputTokens) {
    parts.push(formatTokens(model.maxOutputTokens, "out"));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function formatPrice(model: CatalogModel): string | null {
  if (model.promptPrice === null && model.completionPrice === null) {
    return "variable pricing";
  }
  const perMillion = (price: number | null) =>
    price === null ? "?" : `$${(price * 1_000_000).toFixed(2)}`;
  return `${perMillion(model.promptPrice)}/M in · ${perMillion(model.completionPrice)}/M out`;
}

// OpenAI and Anthropic quote no prices on the endpoint that lists their models,
// so a whole list without one is a provider that does not publish them — not a
// list of models that are free or variably priced.
function publishesPrices(models: CatalogModel[]): boolean {
  return models.some(
    (m) => m.promptPrice !== null || m.completionPrice !== null,
  );
}

export function ModelPicker({
  provider,
  value,
  onChange,
}: {
  provider: Provider;
  value: string;
  onChange: (modelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const {
    data: models,
    error,
    isFetching,
  } = useQuery({
    queryKey: queryKeys.models(provider),
    queryFn: async () => {
      const body = await apiFetch<{ models?: CatalogModel[] }>(
        `/api/models?provider=${provider}`,
      );
      if (!body.models) throw new Error("Could not load models");
      return body.models;
    },
    enabled: open,
    staleTime: Infinity,
  });

  const priced = useMemo(
    () => (models ? publishesPrices(models) : false),
    [models],
  );

  const matches = useMemo(() => {
    if (!models) return [];
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return models;
    return models.filter((m) => {
      const haystack = `${m.id} ${m.name}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [models, query]);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="min-w-0 text-xs font-normal"
        onClick={() => setOpen(true)}
      >
        <span className="max-w-48 truncate">{value}</span>
        <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Choose a model</DialogTitle>
            <DialogDescription>
              Every model your {PROVIDER_LABELS[provider]} key can reach. A few
              need their own setup or credit on that account.
            </DialogDescription>
          </DialogHeader>

          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or id…"
            aria-label="Search models"
          />

          <ScrollArea className="h-80">
            {error && !isFetching ? (
              <p className="p-3 text-sm text-destructive">{error.message}</p>
            ) : !models ? (
              <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading models…
              </p>
            ) : matches.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                No model matches “{query}”.
              </p>
            ) : (
              <div className="space-y-0.5 pr-3">
                {matches.slice(0, MAX_ROWS).map((model) => {
                  const selected = model.id === value;
                  const limits = formatLimits(model);
                  const price = priced ? formatPrice(model) : null;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => {
                        onChange(model.id);
                        setOpen(false);
                        setQuery("");
                      }}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent",
                        selected && "bg-accent",
                      )}
                    >
                      <CheckIcon
                        className={cn(
                          "mt-0.5 size-3.5 shrink-0",
                          selected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          {model.name}
                        </span>
                        {model.id !== model.name && (
                          <span className="block truncate font-mono text-[11px] text-muted-foreground">
                            {model.id}
                          </span>
                        )}
                        {(limits || price) && (
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {[limits, price].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
                {matches.length > MAX_ROWS && (
                  <p className="px-2 py-2 text-[11px] text-muted-foreground">
                    {matches.length - MAX_ROWS} more match — keep typing to
                    narrow the list.
                  </p>
                )}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
