import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// OAuth (PKCE) code exchange endpoint. Google redirects here via Supabase.

/**
 * `next` is attacker-controllable (it rides along on the authorize URL), so it
 * may only ever be an in-app absolute path. Without this check
 * `${origin}${next}` is an open redirect: `next=@evil.com` builds
 * "https://app.example.com@evil.com", which parses as userinfo=app.example.com
 * host=evil.com — a phishing link wearing our domain. A leading "//" (or "/\")
 * is likewise protocol-relative and off-site.
 */
function safeNext(raw: string | null): string {
  const fallback = "/c";
  if (!raw || !raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  return NextResponse.redirect(`${origin}/login?error=oauth`);
}
