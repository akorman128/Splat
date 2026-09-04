import "server-only";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { OPENROUTER_AUTO, type CatalogModel, type Provider } from "./models";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";
const TTL_MS = 60 * 60 * 1000;
const FAILURE_BACKOFF_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 64;

type RawModel = {
  id?: unknown;
  name?: unknown;
  created?: unknown;
  context_length?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown } | null;
  architecture?: {
    output_modalities?: unknown;
    input_modalities?: unknown;
  } | null;
  top_provider?: { max_completion_tokens?: unknown } | null;
  supported_parameters?: unknown;
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
  const parameters = raw.supported_parameters;
  const created = toNumber(raw.created);

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
    // The server tool is a tool call, so only a model that can make one can
    // search. Auto declares the union of everything it might route to and is
    // taken at its word — it routes to a model that can.
    supportsWebSearch:
      raw.id === OPENROUTER_AUTO || !Array.isArray(parameters)
        ? true
        : parameters.includes("tools"),
    releasedAt: created === null ? null : created * 1000,
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

// Anthropic publishes each model's real limits, so the picker can show them and
// streamChat can size max_tokens per model. It publishes no prices, which is
// what the nulls mean here — not that the model is free.
async function loadAnthropic(apiKey: string): Promise<CatalogModel[]> {
  const models: CatalogModel[] = [];
  for await (const model of new Anthropic({ apiKey }).models.list()) {
    models.push({
      id: model.id,
      name: model.display_name || model.id,
      contextLength: model.max_input_tokens,
      maxOutputTokens: model.max_tokens,
      promptPrice: null,
      completionPrice: null,
      supportsImages: model.capabilities?.image_input.supported ?? true,
      // Not among the published capabilities, and every model this endpoint
      // lists takes one of the two web search tools, so there is nothing here
      // to hide the toggle for.
      supportsWebSearch: true,
      releasedAt: Date.parse(model.created_at) || null,
    });
  }
  if (models.length === 0) {
    throw new Error("Anthropic model list was empty");
  }
  return models;
}

// OpenAI lists everything the key can reach, so embeddings, speech, images and
// moderation come back beside the chat models. Nothing in the response says
// which is which, so the id is all there is to go on: an allowed shape, minus
// the words that mark a model this app cannot send a prompt to.
const OPENAI_CHAT_ID = /^(gpt-|chatgpt-|o[1-9]|codex-|ft:)/;
const OPENAI_NOT_CHAT =
  /embedding|moderation|whisper|tts|audio|transcribe|realtime|speech|image|dall-e|sora|video|instruct/;

async function loadOpenAI(apiKey: string): Promise<CatalogModel[]> {
  const listed: { id: string; created: number }[] = [];
  for await (const model of new OpenAI({ apiKey }).models.list()) {
    if (!OPENAI_CHAT_ID.test(model.id)) continue;
    if (OPENAI_NOT_CHAT.test(model.id)) continue;
    listed.push({ id: model.id, created: model.created });
  }
  if (listed.length === 0) {
    throw new Error("OpenAI listed no models this app can prompt");
  }

  // Newest first: the list is long and the model someone wants is usually the
  // one that just shipped.
  return listed
    .sort((a, b) => b.created - a.created || a.id.localeCompare(b.id))
    .map(({ id, created }) => ({
      id,
      name: id,
      // The list carries an id and a release date and nothing else, so every
      // limit and price here is unknown rather than absent.
      contextLength: null,
      maxOutputTokens: null,
      promptPrice: null,
      completionPrice: null,
      supportsImages: true,
      supportsWebSearch: true,
      releasedAt: created * 1000,
    }));
}

type Source = {
  keyed: boolean;
  load(apiKey: string): Promise<CatalogModel[]>;
};

const SOURCES: Record<Provider, Source> = {
  openrouter: { keyed: false, load: loadOpenRouter },
  anthropic: { keyed: true, load: loadAnthropic },
  openai: { keyed: true, load: loadOpenAI },
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

const caches = new Map<string, CacheEntry>();

// Two accounts can see two different lists from the same provider, so a keyed
// catalogue is cached against a digest of the key rather than under the
// provider alone.
function cacheKey(provider: Provider, apiKey: string): string {
  if (!SOURCES[provider].keyed) return provider;
  const digest = createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
  return `${provider}:${digest}`;
}

function cacheFor(key: string): CacheEntry {
  let entry = caches.get(key);
  if (!entry) {
    for (const [existing, value] of caches) {
      if (caches.size < MAX_CACHE_ENTRIES) break;
      if (!value.inFlight) caches.delete(existing);
    }
    entry = { fresh: null, failure: null, inFlight: null };
    caches.set(key, entry);
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

async function catalogue(
  provider: Provider,
  apiKey: string,
): Promise<Catalogue> {
  const cache = cacheFor(cacheKey(provider, apiKey));
  const now = Date.now();

  if (cache.fresh && now - cache.fresh.at < TTL_MS) {
    return cache.fresh;
  }

  if (cache.failure && now - cache.failure.at < FAILURE_BACKOFF_MS) {
    if (cache.fresh) return cache.fresh;
    throw cache.failure.error;
  }

  if (!cache.inFlight) {
    cache.inFlight = SOURCES[provider]
      .load(apiKey)
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
  provider: Provider,
  apiKey: string,
): Promise<CatalogModel[]> {
  return (await catalogue(provider, apiKey)).models;
}

export async function catalogEntry(
  provider: Provider,
  model: string,
  apiKey: string,
): Promise<CatalogModel | null> {
  try {
    return (await catalogue(provider, apiKey)).byId.get(model) ?? null;
  } catch {
    return null;
  }
}

// Anthropic's aliases ("claude-opus-5") answer a request but need not appear in
// the list beside the dated id they resolve to, so an alias that names one
// counts as known.
function names(list: Catalogue, model: string): boolean {
  if (list.byId.has(model)) return true;
  const prefix = `${model}-`;
  for (const id of list.byId.keys()) {
    if (id.startsWith(prefix) && /^\d{8}$/.test(id.slice(prefix.length))) {
      return true;
    }
  }
  return false;
}

// The shape each provider's ids take, for deciding a send when the catalogue
// itself could not be reached — refusing every model because a list is down
// would be worse than letting the provider answer for its own ids.
const MODEL_ID_SHAPES: Record<Provider, RegExp> = {
  openrouter: /^[\w.\-]+\/[\w.\-:]+$/,
  anthropic: /^[\w.\-]+$/,
  openai: /^[\w.\-:]+$/,
};

export async function isKnownCatalogModel(
  provider: Provider,
  model: string,
  apiKey: string,
): Promise<boolean> {
  try {
    return names(await catalogue(provider, apiKey), model);
  } catch {
    return MODEL_ID_SHAPES[provider].test(model);
  }
}
