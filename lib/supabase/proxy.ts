import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/c", "/settings", "/onboarding"];

export async function updateSession(request: NextRequest) {
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

  // Do not run other code between createServerClient and auth.getUser();
  // the session refresh depends on this ordering.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => path === p || path.startsWith(`${p}/`),
  );

  // getUser() above may have refreshed the session, in which case setAll wrote
  // rotated tokens onto supabaseResponse and *only* there. Supabase invalidates
  // the old refresh token when it rotates, so returning a redirect that omits
  // those cookies logs the user out: the browser keeps a spent token, the next
  // refresh fails, and they land back on /login for no visible reason. Every
  // early return has to carry the cookies over.
  const redirectTo = (pathname: string) => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    const response = NextResponse.redirect(url);
    for (const cookie of supabaseResponse.cookies.getAll()) {
      response.cookies.set(cookie);
    }
    return response;
  };

  if (!user && isProtected) {
    return redirectTo("/login");
  }

  if (user && (path === "/" || path === "/login")) {
    return redirectTo("/c");
  }

  return supabaseResponse;
}
