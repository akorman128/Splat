import type { JWK } from "@supabase/supabase-js";

const JWKS_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
const TTL_MS = 10 * 60 * 1000;
const FAILURE_TTL_MS = 30 * 1000;
const TIMEOUT_MS = 2_000;

let cached: { at: number; keys: JWK[] } | null = null;
let failedAt = 0;
let inFlight: Promise<JWK[]> | null = null;

async function load(): Promise<JWK[]> {
  const res = await fetch(JWKS_URL, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`JWKS endpoint returned ${res.status}`);
  }
  const body = (await res.json()) as { keys?: unknown };
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw new Error("JWKS response contained no keys");
  }
  return body.keys as JWK[];
}

export async function signingKeys(): Promise<{ keys: JWK[] } | undefined> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) {
    return { keys: cached.keys };
  }
  if (now - failedAt < FAILURE_TTL_MS) {
    return cached ? { keys: cached.keys } : undefined;
  }
  if (!inFlight) {
    inFlight = load()
      .then((keys) => {
        cached = { at: Date.now(), keys };
        failedAt = 0;
        return keys;
      })
      .catch((err) => {
        failedAt = Date.now();
        throw err;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  try {
    return { keys: await inFlight };
  } catch (err) {
    if (cached) {
      return { keys: cached.keys };
    }
    console.warn(
      `[supabase/jwks] fetch failed: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    );
    return undefined;
  }
}
