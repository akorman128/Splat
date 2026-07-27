import "server-only";
import type { CatalogModel } from "./models";

// OpenRouter's model catalogue. Two consumers: /api/models (fills the
// composer's picker) and /api/chat (validates the requested id before a node
// row is written).
//
// The listing endpoint is *public* — it answers 200 for an unauthenticated
// caller — so this never needs, and never sees, a user's key.
//
// Cached in-process behind a TTL rather than via `next: { revalidate }`: the
// callers are route handlers that read cookies for Supabase auth, which makes
// them request-time and takes their fetches off the framework's data cache.
// Validation sits in the chat hot path, so it gets a cache that holds
// regardless of route semantics.

const CATALOG_URL = "https://openrouter.ai/api/v1/models";
const TTL_MS = 60 * 60 * 1000;

type RawModel = {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown } | null;
  architecture?: { output_modalities?: unknown } | null;
};

let cached: { at: number; models: CatalogModel[] } | null = null;
// Concurrent callers share one request instead of each opening their own.
let inFlight: Promise<CatalogModel[]> | null = null;

function toNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  // OpenRouter prices dynamically-routed models (openrouter/auto) as "-1".
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return n;
}

function normalise(raw: RawModel): CatalogModel | null {
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;

  // Splat renders one markdown response per card, so anything that cannot
  // answer in text (image or audio generators) would only ever produce an
  // empty card. Absent modality data is treated as text — the field is
  // advisory and dropping unlabelled models would be worse than including one.
  const outputs = raw.architecture?.output_modalities;
  if (Array.isArray(outputs) && outputs.length > 0 && !outputs.includes("text")) {
    return null;
  }

  return {
    id: raw.id,
    name: typeof raw.name === "string" && raw.name ? raw.name : raw.id,
    contextLength: toNumber(raw.context_length),
    promptPrice: toNumber(raw.pricing?.prompt),
    completionPrice: toNumber(raw.pricing?.completion),
  };
}

async function load(): Promise<CatalogModel[]> {
  const res = await fetch(CATALOG_URL, {
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

/**
 * The catalogue, from cache when fresh. Throws if OpenRouter is unreachable
 * and nothing is cached; callers decide whether that is fatal.
 */
export async function openRouterCatalog(): Promise<CatalogModel[]> {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return cached.models;
  }
  if (!inFlight) {
    inFlight = load()
      .then((models) => {
        cached = { at: Date.now(), models };
        return models;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  try {
    return await inFlight;
  } catch (err) {
    // A stale catalogue beats no catalogue: model ids are long-lived, and the
    // alternative is rejecting a selection the user made minutes ago.
    if (cached) {
      console.warn(
        `[providers/catalog] refresh failed, serving stale list: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      );
      return cached.models;
    }
    throw err;
  }
}

/**
 * Whether `model` is an id OpenRouter currently serves.
 *
 * Fails *open*: if the catalogue cannot be reached at all we accept any
 * plausibly-shaped id rather than blocking the user's prompt on our own
 * outage. Nothing is lost by doing so — OpenRouter rejects an unknown id with
 * a 400 that the card surfaces verbatim, with a Retry button.
 */
export async function isKnownOpenRouterModel(model: string): Promise<boolean> {
  try {
    return (await openRouterCatalog()).some((m) => m.id === model);
  } catch {
    return /^[\w.\-]+\/[\w.\-:]+$/.test(model);
  }
}
