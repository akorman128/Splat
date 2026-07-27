import "server-only";
import type { JwtPayload } from "@supabase/supabase-js";
import type { createClient } from "./server";
import { signingKeys } from "./jwks";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Verified claims for the current request, or null when signed out.
 *
 * This checks the JWT's signature and expiry locally. It does *not* ask the
 * Auth server whether the session is still live, so a signed-out, deleted or
 * banned user's token still passes until it expires. Use it for navigation and
 * reads, where RLS is the real gate; anything that spends a provider key or
 * touches stored secrets calls getUser() instead.
 *
 * Takes the caller's client rather than building its own: two clients in one
 * request means two GoTrueClient instances, and auth-js single-flights token
 * refresh per instance, so a concurrent refresh would race on a single-use
 * refresh token.
 */
export async function authClaims(supabase: Client): Promise<JwtPayload | null> {
  const { data } = await supabase.auth.getClaims(undefined, {
    jwks: await signingKeys(),
  });
  return data?.claims ?? null;
}
