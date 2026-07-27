import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";
import { getAdapter } from "@/lib/providers";
import { isProvider } from "@/lib/providers/models";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("provider_creds")
    .select("provider, key_last4, label, created_at");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ credentials: data });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { provider?: string; key?: string; label?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { provider, key, label } = body;
  if (!provider || !isProvider(provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }
  if (!key || typeof key !== "string" || key.trim().length < 8) {
    return NextResponse.json(
      { error: "That doesn't look like an API key" },
      { status: 400 },
    );
  }
  const trimmedKey = key.trim();

  const verification = await getAdapter(provider).verifyKey(trimmedKey);
  if (!verification.ok) {
    return NextResponse.json({ error: verification.message }, { status: 422 });
  }

  const { error } = await supabase.from("provider_creds").upsert(
    {
      provider,
      encrypted_key: encryptSecret(trimmedKey),
      key_last4: trimmedKey.slice(-4),
      label: label?.trim() || null,
      user_id: user.id,
    },
    { onConflict: "user_id,provider" },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    provider,
    key_last4: trimmedKey.slice(-4),
  });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider");
  if (!provider || !isProvider(provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  const { error } = await supabase
    .from("provider_creds")
    .delete()
    .eq("provider", provider);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
