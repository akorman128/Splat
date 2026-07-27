"use client";

import { useEffect, useMemo, useState } from "react";
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
import { PROVIDER_LABELS, type CatalogModel, type Provider } from "@/lib/providers/models";

// Searchable picker over a catalogue provider's model list. Only rendered for
// providers where the model is the user's choice rather than a pinned id
// (hasModelCatalog) — OpenRouter serves a few hundred, so this is a filtered
// dialog rather than another entry in the provider dropdown.

// The catalogue is a few hundred KB and changes on the order of days, so it is
// fetched once per page load and shared by every composer that opens the
// dialog. A rejected fetch is evicted so the next open retries.
const catalogCache = new Map<Provider, Promise<CatalogModel[]>>();

function loadCatalog(provider: Provider): Promise<CatalogModel[]> {
  const cached = catalogCache.get(provider);
  if (cached) return cached;

  const pending = fetch(`/api/models?provider=${provider}`)
    .then(async (res) => {
      const data = (await res.json().catch(() => ({}))) as {
        models?: CatalogModel[];
        error?: string;
      };
      if (!res.ok || !data.models) {
        throw new Error(data.error ?? `Could not load models (${res.status})`);
      }
      return data.models;
    })
    .catch((err: unknown) => {
      catalogCache.delete(provider);
      throw err;
    });

  catalogCache.set(provider, pending);
  return pending;
}

/** Rendering every match at once janks the dialog; matches beyond this are counted, not drawn. */
const MAX_ROWS = 80;

function formatContext(tokens: number | null): string | null {
  if (!tokens) return null;
  if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M ctx`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K ctx`;
  return `${tokens} ctx`;
}

/** Catalogue prices are per token; per-million is the unit people compare in. */
function formatPrice(model: CatalogModel): string | null {
  if (model.promptPrice === null && model.completionPrice === null) {
    return "variable pricing";
  }
  const perMillion = (price: number | null) =>
    price === null ? "?" : `$${(price * 1_000_000).toFixed(2)}`;
  return `${perMillion(model.promptPrice)}/M in · ${perMillion(model.completionPrice)}/M out`;
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
  const [models, setModels] = useState<CatalogModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch on open rather than on mount: the composer is always on screen, and
  // most sessions never open the picker. `error` is cleared by the opener, not
  // here — setting state synchronously in an effect body cascades renders.
  useEffect(() => {
    if (!open) return;
    let active = true;
    loadCatalog(provider).then(
      (list) => {
        if (active) setModels(list);
      },
      (err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Could not load models");
        }
      },
    );
    return () => {
      active = false;
    };
  }, [open, provider]);

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
        onClick={() => {
          // Clear a previous failure so reopening genuinely retries the fetch.
          setError(null);
          setOpen(true);
        }}
      >
        <span className="max-w-48 truncate">{value}</span>
        <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // Reopening on a stale filter hides the model the user came for.
          if (!next) setQuery("");
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Choose a model</DialogTitle>
            <DialogDescription>
              Every model your {PROVIDER_LABELS[provider]} key can reach.
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
            {error ? (
              <p className="p-3 text-sm text-destructive">{error}</p>
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
                  const context = formatContext(model.contextLength);
                  const price = formatPrice(model);
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
                        <span className="block truncate font-mono text-[11px] text-muted-foreground">
                          {model.id}
                        </span>
                        {(context || price) && (
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {[context, price].filter(Boolean).join(" · ")}
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
