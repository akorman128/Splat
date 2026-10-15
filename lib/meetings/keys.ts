import "server-only";
import { NextResponse } from "next/server";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { createClient } from "@/lib/supabase/server";
import { GranolaError, type GranolaSession } from "./granola";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type KeyResult =
  { ok: true; apiKey: string } | { ok: false; status: number; error: string };

export type GranolaConnection =
  | {
      ok: true;
      session: GranolaSession;
      save: (session: GranolaSession) => Promise<void>;
      forget: () => Promise<void>;
    }
  | { ok: false; status: number; error: string };

export async function saveGranolaSession(
  supabase: SupabaseServerClient,
  userId: string,
  session: GranolaSession,
  email?: string | null,
): Promise<void> {
  const { error } = await supabase.from("granola_connections").upsert(
    {
      user_id: userId,
      encrypted_session: encryptSecret(JSON.stringify(session)),
      updated_at: new Date().toISOString(),
      ...(email !== undefined ? { email } : {}),
    },
    { onConflict: "user_id" },
  );
  if (error)
    throw new Error(`Could not save the Granola sign-in: ${error.message}`);
}

export async function granolaConnection(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<GranolaConnection> {
  const { data } = await supabase
    .from("granola_connections")
    .select("encrypted_session")
    .maybeSingle();
  if (!data) {
    return {
      ok: false,
      status: 422,
      error: "Granola isn't connected. Sign in to it in Settings.",
    };
  }

  let session: GranolaSession;
  try {
    session = JSON.parse(decryptSecret(data.encrypted_session));
  } catch {
    return {
      ok: false,
      status: 500,
      error:
        "The stored Granola sign-in could not be read. Reconnect it in Settings.",
    };
  }

  return {
    ok: true,
    session,
    save: (next) => saveGranolaSession(supabase, userId, next),
    forget: async () => {
      await supabase.from("granola_connections").delete().eq("user_id", userId);
    },
  };
}

export async function openrouterKey(
  supabase: SupabaseServerClient,
): Promise<KeyResult> {
  const { data } = await supabase
    .from("provider_creds")
    .select("encrypted_key")
    .eq("provider", "openrouter")
    .maybeSingle();
  if (!data) {
    return {
      ok: false,
      status: 422,
      error:
        "Meetings are read aloud through OpenRouter. Add an OpenRouter key in Settings.",
    };
  }
  try {
    return { ok: true, apiKey: decryptSecret(data.encrypted_key) };
  } catch {
    return {
      ok: false,
      status: 500,
      error:
        "Stored OpenRouter key could not be decrypted. Re-add it in Settings.",
    };
  }
}

// A 401 means the grant is gone on Granola's side, so the stored session is
// dropped and Settings offers a fresh sign-in instead of a dead "Connected".
export async function granolaFailure(
  err: unknown,
  connection: Extract<GranolaConnection, { ok: true }>,
): Promise<NextResponse> {
  const status = err instanceof GranolaError ? err.status : 502;
  if (status === 401) await connection.forget();
  return NextResponse.json(
    { error: err instanceof Error ? err.message : "Granola request failed" },
    { status: status >= 500 ? 502 : status },
  );
}
