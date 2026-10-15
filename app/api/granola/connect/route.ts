import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/supabase/dal";
import { encryptSecret } from "@/lib/crypto";
import { beginSignIn } from "@/lib/meetings/granola";
import {
  SIGNIN_COOKIE,
  SIGNIN_COOKIE_PATH,
  SIGNIN_MAX_AGE_SECONDS,
  safeReturnTo,
  withGranolaError,
} from "@/lib/meetings/signin";

export async function GET(request: NextRequest) {
  if (!(await currentUser())) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));
  const redirectUrl = new URL("/api/granola/callback", request.url).toString();

  let started: Awaited<ReturnType<typeof beginSignIn>>;
  try {
    started = await beginSignIn(redirectUrl, returnTo);
  } catch (err) {
    return NextResponse.redirect(
      withGranolaError(
        returnTo,
        request.url,
        err instanceof Error
          ? err.message
          : "Could not start the Granola sign-in.",
      ),
    );
  }

  const response = NextResponse.redirect(started.url);
  response.cookies.set(
    SIGNIN_COOKIE,
    encryptSecret(JSON.stringify(started.pending)),
    {
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: SIGNIN_COOKIE_PATH,
      maxAge: SIGNIN_MAX_AGE_SECONDS,
    },
  );
  return response;
}
