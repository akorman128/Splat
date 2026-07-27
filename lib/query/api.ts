// The single transport for every call the browser makes to /api. Query and
// mutation functions call these; nothing below them touches fetch directly.

const NETWORK_ERROR = "Network error — the request never reached the server.";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function send(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    // status 0: the request never got an answer, so retry policy treats it as
    // a network failure rather than any HTTP class.
    throw new ApiError(NETWORK_ERROR, 0);
  }
}

// A route handler can answer with something that isn't JSON — a platform
// 502/504 HTML page, or the 500 thrown when APP_ENCRYPTION_KEY is missing — so
// the body is parsed defensively and the status stands in when it has no
// `error` field of its own.
async function failure(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
}

export function postJson(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await send(url, init);
  if (!res.ok) throw await failure(res);
  return (await res.json().catch(() => ({}))) as T;
}

/**
 * Hands back the raw body instead of parsing it, for /api/chat — the one route
 * whose response is consumed as it arrives rather than read to the end.
 */
export async function apiStream(
  url: string,
  body: unknown,
): Promise<ReadableStream<Uint8Array>> {
  const res = await send(url, postJson(body));
  if (!res.ok || !res.body) throw await failure(res);
  return res.body;
}
