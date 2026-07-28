import "server-only";
import { cache } from "react";
import { createClient } from "./server";

export type SessionUser = { id: string; email: string | null };

// getClaims verifies the JWT against the project's signing keys, which
// supabase-js discovers and caches itself. Prefer it over getUser, which spends
// a round trip to the Auth server on every call.
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    return null;
  }
  return { id: data.claims.sub, email: data.claims.email ?? null };
});
