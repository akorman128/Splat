import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";
import { decryptSecret } from "@/lib/crypto";
import { modelCatalog } from "@/lib/providers/catalog";
import { PROVIDER_LABELS, isProvider } from "@/lib/providers/models";

export async function GET(request: Request) {
  const supabase = await createClient();
  if (!(await currentUser())) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const provider = new URL(request.url).searchParams.get("provider");
  if (!provider || !isProvider(provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  // OpenAI and Anthropic only list models to a key, and the list is the one
  // that key can reach — so the picker asks with the same credential the send
  // will use, not a shared one.
  const { data: cred } = await supabase
    .from("provider_creds")
    .select("encrypted_key")
    .eq("provider", provider)
    .maybeSingle();
  if (!cred) {
    return NextResponse.json(
      {
        error: `No ${PROVIDER_LABELS[provider]} API key connected. Add one in Settings.`,
      },
      { status: 422 },
    );
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(cred.encrypted_key);
  } catch {
    return NextResponse.json(
      {
        error: `Stored ${PROVIDER_LABELS[provider]} key could not be decrypted. Re-add it in Settings.`,
      },
      { status: 500 },
    );
  }

  try {
    return NextResponse.json({ models: await modelCatalog(provider, apiKey) });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Could not load the ${PROVIDER_LABELS[provider]} model list: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      },
      { status: 502 },
    );
  }
}
