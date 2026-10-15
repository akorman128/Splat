import "server-only";
import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  UnauthorizedError,
  auth,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { TranscriptLine } from "./transcript";

// Granola's public API only takes API keys; its MCP server is the one that
// signs a user in through the browser.
// https://docs.granola.ai/help-center/sharing/integrations/mcp
const MCP_URL = "https://mcp.granola.ai/mcp";
const SCOPE = "mcp offline_access";

export type GranolaSession = {
  client: OAuthClientInformationMixed;
  tokens: OAuthTokens;
  redirectUrl: string;
};

export type PendingSignIn = {
  client: OAuthClientInformationMixed;
  verifier: string;
  state: string;
  redirectUrl: string;
  returnTo: string;
};

export type GranolaMeetingSummary = {
  id: string;
  title: string;
  meeting_at: string;
  participants: string[];
  people: string;
};

export class GranolaError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GranolaError";
    this.status = status;
  }
}

function signedOut(): GranolaError {
  return new GranolaError(
    "Granola signed Splat out. Reconnect it in Settings.",
    401,
  );
}

export const MEETING_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clientMetadata(redirectUrl: string): OAuthClientMetadata {
  return {
    client_name: "Splat",
    redirect_uris: [redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: SCOPE,
  };
}

// The client is registered afresh on every sign-in rather than once per
// deployment: the registration names the callback URL, and a preview
// deployment or localhost has a different one.
export async function beginSignIn(
  redirectUrl: string,
  returnTo: string,
): Promise<{ url: URL; pending: PendingSignIn }> {
  const state = randomBytes(24).toString("base64url");
  let client: OAuthClientInformationMixed | undefined;
  let verifier: string | undefined;
  let url: URL | undefined;
  const provider: OAuthClientProvider = {
    redirectUrl,
    clientMetadata: clientMetadata(redirectUrl),
    state: () => state,
    clientInformation: () => client,
    saveClientInformation: (info) => {
      client = info;
    },
    tokens: () => undefined,
    saveTokens: () => {},
    saveCodeVerifier: (value) => {
      verifier = value;
    },
    codeVerifier: () => verifier ?? "",
    redirectToAuthorization: (authorizationUrl) => {
      url = authorizationUrl;
    },
  };

  await auth(provider, { serverUrl: MCP_URL, scope: SCOPE });
  if (!url || !client || !verifier) {
    throw new GranolaError("Granola did not start a sign-in.", 502);
  }
  return { url, pending: { client, verifier, state, redirectUrl, returnTo } };
}

export async function finishSignIn(
  pending: PendingSignIn,
  code: string,
): Promise<GranolaSession> {
  let tokens: OAuthTokens | undefined;
  const provider: OAuthClientProvider = {
    redirectUrl: pending.redirectUrl,
    clientMetadata: clientMetadata(pending.redirectUrl),
    clientInformation: () => pending.client,
    tokens: () => undefined,
    saveTokens: (value) => {
      tokens = value;
    },
    saveCodeVerifier: () => {},
    codeVerifier: () => pending.verifier,
    redirectToAuthorization: () => {
      throw signedOut();
    },
  };

  await auth(provider, {
    serverUrl: MCP_URL,
    authorizationCode: code,
    scope: SCOPE,
  });
  if (!tokens) throw new GranolaError("Granola did not sign you in.", 502);
  return { client: pending.client, tokens, redirectUrl: pending.redirectUrl };
}

// onRefresh is how a rotated token reaches storage: the transport refreshes
// an expired access token by itself, and the old refresh token may stop
// working the moment it does.
async function withGranola<T>(
  session: GranolaSession,
  onRefresh: (session: GranolaSession) => Promise<void>,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const provider: OAuthClientProvider = {
    redirectUrl: session.redirectUrl,
    clientMetadata: clientMetadata(session.redirectUrl),
    clientInformation: () => session.client,
    saveClientInformation: (info) => {
      session.client = info;
    },
    tokens: () => session.tokens,
    saveTokens: async (tokens) => {
      session.tokens = tokens;
      await onRefresh(session);
    },
    saveCodeVerifier: () => {},
    codeVerifier: () => "",
    redirectToAuthorization: () => {
      throw signedOut();
    },
  };

  const client = new Client({ name: "splat", version: "0.1.0" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(MCP_URL), {
        authProvider: provider,
      }),
    );
    return await run(client);
  } catch (err) {
    if (err instanceof GranolaError) throw err;
    if (err instanceof UnauthorizedError) throw signedOut();
    throw new GranolaError(
      `Could not reach Granola: ${err instanceof Error ? err.message : "unknown error"}`,
      502,
    );
  } finally {
    await client.close().catch(() => {});
  }
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  const parts = Array.isArray(result.content) ? result.content : [];
  const text = parts
    .flatMap((part: { type?: string; text?: string }) =>
      part.type === "text" && part.text ? [part.text] : [],
    )
    .join("\n");
  if (result.isError) {
    throw new GranolaError(text || `Granola's ${name} tool failed.`, 502);
  }
  return text;
}

// The tools answer in text written for a model to read rather than a
// versioned schema, so anything unexpected is reported as unreadable instead
// of being imported half-parsed.
function unreadable(what: string): GranolaError {
  return new GranolaError(
    `Granola sent ${what} Splat couldn't read. Its format may have changed.`,
    502,
  );
}

function parseJson(text: string, what: string): Record<string, unknown> {
  const start = text.indexOf("{");
  try {
    const value: unknown = JSON.parse(start >= 0 ? text.slice(start) : text);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {}
  throw unreadable(what);
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|\w+);/gi,
    (match, entity: string) => {
      if (entity[0] === "#") {
        const code =
          entity[1]?.toLowerCase() === "x"
            ? parseInt(entity.slice(2), 16)
            : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return ENTITIES[entity.toLowerCase()] ?? match;
    },
  );
}

// "Alexander Korman (note creator) from Blueyard <alex@…>, Astrid <astrid@…>":
// the names are what the list shows, and the whole line is what search
// matches, so a company or an email finds the meeting too.
function participantNames(people: string): string[] {
  return people
    .split(/,\s*(?=[^,]*<)/)
    .filter((person) => !person.includes("(note creator)"))
    .map((person) => person.replace(/\s*(?:\bfrom\b.*|<.*)$/, "").trim())
    .filter(Boolean);
}

function parseMeetingList(text: string): GranolaMeetingSummary[] {
  if (!text.includes("<meetings_data")) throw unreadable("a meeting list");
  const meetings: GranolaMeetingSummary[] = [];
  for (const [, attributes, body] of text.matchAll(
    /<meeting\s([^>]*)>([\s\S]*?)<\/meeting>/g,
  )) {
    const fields = new Map(
      [...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [
        key,
        decodeEntities(value),
      ]),
    );
    const id = fields.get("id");
    const meetingAt = fields.get("meeting_at") ?? fields.get("created_at");
    if (!id || !MEETING_ID_PATTERN.test(id) || !meetingAt) continue;
    const people = decodeEntities(
      body.match(/<known_participants>([\s\S]*?)<\/known_participants>/)?.[1] ??
        "",
    )
      .replace(/\s+/g, " ")
      .trim();
    meetings.push({
      id,
      title: fields.get("title")?.trim() || "Untitled meeting",
      meeting_at: meetingAt,
      participants: participantNames(people),
      people,
    });
  }
  return meetings.sort(
    (a, b) => Date.parse(b.meeting_at) - Date.parse(a.meeting_at),
  );
}

// Labels look like "Microphone", "System audio" or "System audio (Name)",
// with mobile recordings using "Speaker A". The microphone is the recorder's,
// which is the note's owner and not necessarily the person signed in.
function speakerFor(label: string, recorder: string | null): string {
  const named = label.match(/^(?:Microphone|System audio)\s*\((.+)\)$/);
  if (named) return named[1].trim();
  if (label === "Microphone") return recorder ?? "You";
  if (label === "System audio") return "Them";
  return label;
}

// Desktop transcripts put a blank line between turns and mobile ones only a
// newline, so every line is a candidate turn. A label is short and has no
// sentence punctuation, which keeps "So the plan: ..." inside its turn.
const TURN = /^([^:.,?!\n]{1,60}):\s+(.*)$/;

function parseTranscriptText(
  transcript: string,
  recorder: string | null,
): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  for (const raw of transcript.split("\n")) {
    const text = raw.trim();
    if (!text) continue;
    const turn = text.match(TURN);
    if (turn) {
      lines.push({
        speaker: speakerFor(turn[1].trim(), recorder),
        text: turn[2].trim(),
      });
    } else if (lines.length > 0) {
      lines[lines.length - 1].text += ` ${text}`;
    } else {
      lines.push({ speaker: "Unknown", text });
    }
  }
  return lines;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Granola's own history starts after this, so it is "everything". One call
// covers it: list_meetings has no cursor, and a year of meetings is a few
// dozen kilobytes of text.
const HISTORY_START = "2020-01-01";
const DAY_MS = 86_400_000;

// The range ends tomorrow in UTC so that today is covered wherever the
// user's Granola timezone puts it.
export function listGranolaMeetings(
  session: GranolaSession,
  onRefresh: (session: GranolaSession) => Promise<void>,
): Promise<GranolaMeetingSummary[]> {
  return withGranola(session, onRefresh, async (client) => {
    const text = await callTool(client, "list_meetings", {
      time_range: "custom",
      custom_start: HISTORY_START,
      custom_end: isoDate(new Date(Date.now() + DAY_MS)),
    });
    return parseMeetingList(text);
  });
}

export function getGranolaTranscript(
  session: GranolaSession,
  onRefresh: (session: GranolaSession) => Promise<void>,
  meetingId: string,
): Promise<{ title: string; metAt: string; lines: TranscriptLine[] }> {
  return withGranola(session, onRefresh, async (client) => {
    const data = parseJson(
      await callTool(client, "get_meeting_transcript", {
        meeting_id: meetingId,
      }),
      "a transcript",
    );
    if (typeof data.transcript !== "string") throw unreadable("a transcript");

    const context = data.recording_context as
      { recorder?: { name?: unknown } } | undefined;
    const recorder =
      typeof context?.recorder?.name === "string"
        ? context.recorder.name
        : null;
    const metAt =
      typeof data.meeting_at === "string"
        ? data.meeting_at
        : typeof data.created_at === "string"
          ? data.created_at
          : new Date().toISOString();

    return {
      title:
        (typeof data.title === "string" && data.title.trim()) ||
        "Untitled meeting",
      metAt,
      lines: parseTranscriptText(data.transcript, recorder),
    };
  });
}

export function getGranolaEmail(
  session: GranolaSession,
  onRefresh: (session: GranolaSession) => Promise<void>,
): Promise<string | null> {
  return withGranola(session, onRefresh, async (client) => {
    const data = parseJson(
      await callTool(client, "get_account_info"),
      "account details",
    );
    return typeof data.email === "string" ? data.email : null;
  });
}

// Revokes this connection's grant on Granola's side, so disconnecting in
// Splat is not just forgetting a token that still works.
export function signOutOfGranola(session: GranolaSession): Promise<void> {
  return withGranola(
    session,
    async () => {},
    async (client) => {
      await callTool(client, "sign_out");
    },
  );
}
