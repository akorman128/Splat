import "server-only";

export const SIGNIN_COOKIE = "granola_signin";
export const SIGNIN_COOKIE_PATH = "/api/granola";
export const SIGNIN_MAX_AGE_SECONDS = 600;

export function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/meetings";
  }
  if (value.includes("\\")) return "/meetings";
  return value;
}

export function withGranolaError(
  returnTo: string,
  base: string,
  message: string,
): URL {
  const url = new URL(returnTo, base);
  url.searchParams.set("granola_error", message);
  return url;
}
