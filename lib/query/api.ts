
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
    throw new ApiError(NETWORK_ERROR, 0);
  }
}

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

export async function apiStream(
  url: string,
  body: unknown,
): Promise<ReadableStream<Uint8Array>> {
  const res = await send(url, postJson(body));
  if (!res.ok || !res.body) throw await failure(res);
  return res.body;
}
