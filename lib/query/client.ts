import { QueryClient, isServer } from "@tanstack/react-query";
import { ApiError } from "./api";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        // A 4xx is the server's considered answer — no key, bad payload, not
        // authenticated — and asking again produces the same one. Only network
        // failures and 5xx are worth a second attempt.
        retry: (failureCount, error) =>
          error instanceof ApiError && error.status >= 400 && error.status < 500
            ? false
            : failureCount < 1,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/**
 * One client per browser tab, a fresh one per server render. A module-level
 * singleton on the server would be shared across concurrent requests, leaking
 * one user's cache into another's render.
 */
export function getQueryClient(): QueryClient {
  if (isServer) return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
