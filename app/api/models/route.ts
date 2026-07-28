import { NextResponse } from "next/server";
import { currentUser } from "@/lib/supabase/dal";
import { modelCatalog } from "@/lib/providers/catalog";
import {
  PROVIDER_LABELS,
  hasModelCatalog,
  isProvider,
} from "@/lib/providers/models";

export async function GET(request: Request) {
  if (!(await currentUser())) {
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
