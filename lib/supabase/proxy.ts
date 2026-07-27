import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { signingKeys } from "./jwks";

const PROTECTED_PREFIXES = ["/c", "/settings", "/onboarding"];

export async function updateSession(request: NextRequest) {
  // Resolved before the client is built so it cannot land between
  // createServerClient and the auth call below.
  const jwks = await signingKeys();

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run other code between createServerClient and the auth call; the
  // session refresh depends on this ordering. getClaims() reads the session
  // first, so an expiring token still refreshes here as it did under getUser().
  const { data } = await supabase.auth.getClaims(undefined, { jwks });
  const claims = data?.claims ?? null;

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => path === p || path.startsWith(`${p}/`),
  );

  // The auth call above may have refreshed the session, in which case setAll
  // wrote rotated tokens onto supabaseResponse and *only* there. Supabase
  // invalidates the old refresh token when it rotates, so returning a redirect
  // that omits those cookies logs the user out: the browser keeps a spent
  // token, the next refresh fails, and they land back on /login for no visible
  // reason. Every early return has to carry the cookies over.
  const redirectTo = (pathname: string) => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    const response = NextResponse.redirect(url);
    for (const cookie of supabaseResponse.cookies.getAll()) {
      response.cookies.set(cookie);
    }
    return response;
  };

  if (!claims && isProtected) {
    return redirectTo("/login");
  }

  if (claims && (path === "/" || path === "/login")) {
    return redirectTo("/c");
  }

  return supabaseResponse;
}
