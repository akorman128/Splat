import "server-only";
import type { CatalogModel, CatalogProvider } from "./models";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";
const TTL_MS = 60 * 60 * 1000;
const FAILURE_BACKOFF_MS = 60 * 1000;

type RawModel = {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown } | null;
  architecture?: {
    output_modalities?: unknown;
    input_modalities?: unknown;
  } | null;
  top_provider?: { max_completion_tokens?: unknown } | null;
};

function toNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return n;
}

function normalise(raw: RawModel): CatalogModel | null {
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;

  const outputs = raw.architecture?.output_modalities;
  if (
    Array.isArray(outputs) &&
    outputs.length > 0 &&
    !outputs.includes("text")
  ) {
    return null;
  }

  const inputs = raw.architecture?.input_modalities;

  return {
    id: raw.id,
    name: typeof raw.name === "string" && raw.name ? raw.name : raw.id,
    contextLength: toNumber(raw.context_length),
    maxOutputTokens: toNumber(raw.top_provider?.max_completion_tokens),
    promptPrice: toNumber(raw.pricing?.prompt),
    completionPrice: toNumber(raw.pricing?.completion),
    // A model that declares nothing is assumed to take images: the catalogue is
    // third-party data, and refusing a send on a missing field would be our bug
    // showing up as the user's.
    supportsImages: Array.isArray(inputs) ? inputs.includes("image") : true,
  };
}

async function loadOpenRouter(): Promise<CatalogModel[]> {
  const res = await fetch(OPENROUTER_URL, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter model list returned ${res.status}`);
  }
  const body = (await res.json()) as { data?: unknown };
  if (!Array.isArray(body.data)) {
    throw new Error("OpenRouter model list had no data array");
  }

  const models = body.data
    .map((m) => normalise(m as RawModel))
    .filter((m): m is CatalogModel => m !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (models.length === 0) {
    throw new Error("OpenRouter model list was empty");
  }
  return models;
}

const LOADERS: Record<CatalogProvider, () => Promise<CatalogModel[]>> = {
  openrouter: loadOpenRouter,
};

type Catalogue = {
  at: number;
  models: CatalogModel[];
  byId: Map<string, CatalogModel>;
};

type CacheEntry = {
  fresh: Catalogue | null;
  failure: { at: number; error: Error } | null;
  inFlight: Promise<Catalogue> | null;
};

const caches = new Map<CatalogProvider, CacheEntry>();

function cacheFor(provider: CatalogProvider): CacheEntry {
  let entry = caches.get(provider);
  if (!entry) {
    entry = { fresh: null, failure: null, inFlight: null };
    caches.set(provider, entry);
  }
  return entry;
}

function index(models: CatalogModel[]): Catalogue {
  return {
    at: Date.now(),
    models,
    byId: new Map(models.map((m) => [m.id, m])),
  };
}

async function catalogue(provider: CatalogProvider): Promise<Catalogue> {
  const cache = cacheFor(provider);
  const now = Date.now();

  if (cache.fresh && now - cache.fresh.at < TTL_MS) {
    return cache.fresh;
  }

  if (cache.failure && now - cache.failure.at < FAILURE_BACKOFF_MS) {
    if (cache.fresh) return cache.fresh;
    throw cache.failure.error;
  }

  if (!cache.inFlight) {
    cache.inFlight = LOADERS[provider]()
      .then((models) => {
        const loaded = index(models);
        cache.fresh = loaded;
        cache.failure = null;
        return loaded;
      })
      .catch((err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        cache.failure = { at: Date.now(), error };
        throw error;
      })
      .finally(() => {
        cache.inFlight = null;
      });
  }

  try {
    return await cache.inFlight;
  } catch (err) {
    if (cache.fresh) {
      console.warn(
        `[providers/catalog] ${provider} refresh failed, serving stale list: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      );
      return cache.fresh;
    }
    throw err;
  }
}

export async function modelCatalog(
  provider: CatalogProvider,
): Promise<CatalogModel[]> {
  return (await catalogue(provider)).models;
}

export async function catalogEntry(
  provider: CatalogProvider,
  model: string,
): Promise<CatalogModel | null> {
  try {
    return (await catalogue(provider)).byId.get(model) ?? null;
  } catch {
    return null;
  }
}

export async function isKnownCatalogModel(
  provider: CatalogProvider,
  model: string,
): Promise<boolean> {
  try {
    return (await catalogue(provider)).byId.has(model);
  } catch {
    return /^[\w.\-]+\/[\w.\-:]+$/.test(model);
  }
}
