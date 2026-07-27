import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { authClaims } from "@/lib/supabase/claims";
import { modelCatalog } from "@/lib/providers/catalog";
import {
  PROVIDER_LABELS,
  hasModelCatalog,
  isProvider,
} from "@/lib/providers/models";

// Model catalogue for providers that have one (currently OpenRouter), so the
// composer can offer every model the provider serves.
//
// Proxied rather than fetched from the browser for the same reason every other
// provider call is: the client talks to our API, never to a provider. It is
// also the only place the response gets normalised and the non-text models
// filtered out, so the picker and /api/chat's validation agree on one list.

export async function GET(request: Request) {
  const supabase = await createClient();
  const claims = await authClaims(supabase);
  if (!claims) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const provider = new URL(request.url).searchParams.get("provider");
  if (!provider || !isProvider(provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }
  if (!hasModelCatalog(provider)) {
    return NextResponse.json(
      { error: `${provider} has a fixed model, not a catalogue` },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({ models: await modelCatalog(provider) });
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
