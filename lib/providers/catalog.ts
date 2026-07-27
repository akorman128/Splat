import "server-only";
import type { CatalogModel, CatalogProvider } from "./models";

// Live model catalogues for catalogue providers. Three consumers: /api/models
// (fills the composer's picker), /api/chat (validates the requested id before a
// node row is written) and the adapters (per-model request limits).
//
// The listing endpoint is public, so this never sees a user's key — which also
// means it lists what the provider serves, not what a given key can reach.
//
// Cached in-process behind a TTL rather than via `next: { revalidate }`: the
// callers read cookies for Supabase auth, which makes them request-time and
// takes their fetches off the framework's data cache.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";
const TTL_MS = 60 * 60 * 1000;
// Applies only once a list has been cached: after a failed *refresh*, keep
// serving the stale one for this long instead of re-opening a request per
// caller. A cold cache never backs off — there is nothing to serve instead,
// and concurrent callers already coalesce onto one in-flight request, so a
// transient first failure must not lock the picker out for a whole minute.
const FAILURE_BACKOFF_MS = 60 * 1000;

type RawModel = {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown } | null;
  architecture?: { output_modalities?: unknown } | null;
  top_provider?: { max_completion_tokens?: unknown } | null;
};

function toNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  // OpenRouter prices dynamically-routed models (openrouter/auto) as "-1".
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return n;
}

function normalise(raw: RawModel): CatalogModel | null {
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;

  // Splat renders one markdown response per card, so an image or audio
  // generator would only ever produce an empty one. Absent modality data is
  // treated as text — the field is advisory.
  const outputs = raw.architecture?.output_modalities;
  if (
    Array.isArray(outputs) &&
    outputs.length > 0 &&
    !outputs.includes("text")
  ) {
    return null;
  }

  return {
    id: raw.id,
    name: typeof raw.name === "string" && raw.name ? raw.name : raw.id,
    contextLength: toNumber(raw.context_length),
    maxOutputTokens: toNumber(raw.top_provider?.max_completion_tokens),
    promptPrice: toNumber(raw.pricing?.prompt),
    completionPrice: toNumber(raw.pricing?.completion),
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

// The array is what /api/models serialises; the index is what per-request
// lookups use. Both callers of catalogEntry/isKnownCatalogModel run in the
// chat hot path, so neither should rescan a few hundred rows.
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

  // Stale list in hand and a recent failure: skip the network entirely rather
  // than make every caller pay the fetch timeout. Model ids are long-lived.
  if (
    cache.fresh &&
    cache.failure &&
    now - cache.failure.at < FAILURE_BACKOFF_MS
  ) {
    return cache.fresh;
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

/**
 * A provider's catalogue, from cache when fresh. Throws only when the upstream
 * is unreachable and nothing has ever been cached; callers decide whether that
 * is fatal.
 */
export async function modelCatalog(
  provider: CatalogProvider,
): Promise<CatalogModel[]> {
  return (await catalogue(provider)).models;
}

/**
 * A single catalogue row, or null when the id is unknown *or* the catalogue
 * cannot be reached. Callers must read null as "no metadata available", not as
 * "model does not exist" — isKnownCatalogModel answers that question, and it
 * fails open on purpose.
 */
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

/**
 * Whether `model` is an id this provider currently serves.
 *
 * Fails *open*: if the catalogue cannot be reached at all we accept any
 * plausibly-shaped id rather than blocking the user's prompt on our own
 * outage. The provider rejects an unknown id with a 400 the card surfaces
 * verbatim, with a Retry button.
 */
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
