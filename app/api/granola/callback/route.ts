import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/dal";
import { decryptSecret } from "@/lib/crypto";
import {
  finishSignIn,
  getGranolaEmail,
  type PendingSignIn,
} from "@/lib/meetings/granola";
import { saveGranolaSession } from "@/lib/meetings/keys";
import {
  SIGNIN_COOKIE,
  SIGNIN_COOKIE_PATH,
  withGranolaError,
} from "@/lib/meetings/signin";

function readPending(value: string | undefined): PendingSignIn | null {
  if (!value) return null;
  try {
    return JSON.parse(decryptSecret(value)) as PendingSignIn;
  } catch {
    return null;
  }
}

function sameState(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const pending = readPending(request.cookies.get(SIGNIN_COOKIE)?.value);
  const params = request.nextUrl.searchParams;
  const returnTo = pending?.returnTo ?? "/meetings";

  const finish = (url: URL) => {
    const response = NextResponse.redirect(url);
    response.cookies.delete({ name: SIGNIN_COOKIE, path: SIGNIN_COOKIE_PATH });
    return response;
  };
  const fail = (message: string) =>
    finish(withGranolaError(returnTo, request.url, message));

  if (!pending) {
    return fail("The Granola sign-in expired. Try connecting again.");
  }
  if (params.get("error")) {
    return fail(
      params.get("error") === "access_denied"
        ? "Granola access was not granted."
        : `Granola sign-in failed: ${params.get("error_description") ?? params.get("error")}`,
    );
  }
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state || !sameState(state, pending.state)) {
    return fail("The Granola sign-in could not be verified. Try again.");
  }

  const supabase = await createClient();
  try {
    const session = await finishSignIn(pending, code);
    const email = await getGranolaEmail(session, async () => {}).catch(
      () => null,
    );
    await saveGranolaSession(supabase, user.id, session, email);
  } catch (err) {
    return fail(
      err instanceof Error
        ? err.message
        : "Could not finish the Granola sign-in.",
    );
  }

  return finish(new URL(returnTo, request.url));
}
