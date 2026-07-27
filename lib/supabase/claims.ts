import "server-only";
import type { JwtPayload } from "@supabase/supabase-js";
import type { createClient } from "./server";
import { signingKeys } from "./jwks";

type Client = Awaited<ReturnType<typeof createClient>>;

export async function authClaims(supabase: Client): Promise<JwtPayload | null> {
  const { data } = await supabase.auth.getClaims(undefined, {
    jwks: await signingKeys(),
  });
  return data?.claims ?? null;
}
