# Splat — a graph-native AI chat canvas

Instead of one linear transcript, every prompt/response pair is a **card** on an
infinite [tldraw](https://tldraw.dev) canvas. Cards are linked as a DAG, and you
control exactly which ancestor cards are sent as context with each new prompt.

- **Supabase** owns graph semantics (nodes, edges, suggestions, auth, RLS).
- **tldraw** owns geometry only — card shapes hold a `nodeId` and nothing else;
  positions are persisted back to `nodes.canvas_*`, debounced.
- **All LLM calls originate in server route handlers.** Provider SDKs and keys
  are never imported by client code (`import "server-only"` enforces this at
  build time). The client's only path to a model is `fetch` against `/api/*`.
- **BYOK**: each user connects their own OpenAI and/or Anthropic API key after
  sign-in. Keys are verified against the provider's models endpoint, encrypted
  at rest (AES-256-GCM), and decrypted only inside route handlers.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · Tailwind v4 + shadcn/ui
(Base UI generation) · tldraw 5 · Supabase (Postgres, Auth, RLS) ·
zustand · react-markdown · openai + @anthropic-ai/sdk (server-only).

## Setup

```sh
npm install
cp .env.example .env.local   # then fill in:
```

| Variable | What it is |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The project's publishable (anon) key |
| `APP_ENCRYPTION_KEY` | 32 bytes base64 (`openssl rand -base64 32`). Encrypts BYOK provider keys at rest. Server-only. |

### Database

Migrations live in `supabase/migrations/`. Apply with the Supabase CLI:

```sh
supabase link --project-ref <project-ref>
supabase db push
```

This creates `profiles`, `provider_creds`, `conversations`, `nodes`,
`context_edges`, `suggestions` — all with RLS scoping rows to `auth.uid()` —
plus a recursive-CTE trigger that rejects context edges that would create a
cycle, and a trigger that auto-creates a profile row on signup.

### Auth configuration (Supabase dashboard)

- **Email + password** works out of the box (email auto-confirm is enabled on
  the linked project so no SMTP is needed).
- **Google OAuth** needs a Google Cloud OAuth client: enable the Google
  provider under *Authentication → Providers* and paste the client id/secret.
  Until then the "Continue with Google" button will return a provider error.

### Run

```sh
npm run dev     # http://localhost:3000
```

## Model configuration

`lib/providers/models.ts` is the **only** place model ids live — a
`role → model id` map per provider:

| Provider | Conversation model | Utility model |
| --- | --- | --- |
| OpenAI | `gpt-5.6-sol` | `gpt-5.6-luna` |
| Anthropic | `claude-opus-5` | `claude-haiku-4-5` |
| OpenRouter | any catalogue id (default `openrouter/auto`) | `google/gemini-2.5-flash-lite` |

The composer's first dropdown selects the **provider**, not the model. OpenAI
and Anthropic expose exactly one conversation model each — the pinned id above
— and `/api/chat` rejects anything else. OpenRouter is the exception: it is a
*catalogue* provider (`CATALOG_PROVIDERS`), so a second picker appears next to
it listing the live catalogue from `/api/models`, and any id that catalogue
currently serves is accepted. Either way the response is streamed. Validation
fails *open*: if the catalogue cannot be reached at all, any plausibly-shaped
`vendor/model` id is let through rather than blocking a send on our own outage.

The catalogue is OpenRouter's **public** listing, so it is not scoped to the
key: a handful of ids need their own upstream provider setup or account credit
and will fail at send time. It also carries each model's context window and,
where the provider declares one, its output ceiling. The adapter sizes
`max_tokens` from both of those *and* the estimated prompt size, since a
declared output cap does not exempt a model from its context window — a fixed
budget is only safe for a pinned model. Where the catalogue declares neither
(including `openrouter/auto`, whose figures are the union across everything it
may route to) the request goes out with no `max_tokens` and OpenRouter applies
the model's own default.

The utility model handles the structured "title + exactly 3 suggestions" call
(strict JSON schema, low output budget) and is fixed per provider regardless of
the conversation model. If it is unavailable on an account, the adapter falls
back one tier up and logs it — for a catalogue provider that means the card's
own model, `openrouter/auto` included, since the default selection would
otherwise have no fallback at all.

## Verification click-paths (per build step)

1. **Shell + auth** — Open `/`, click *Sign in*, create an account with email +
   password. You land in the app shell: collapsible sidebar (conversations,
   New conversation, account menu with Settings/Sign out).
2. **Migrations + RLS** — Sign up a second account: it sees no conversations
   from the first (RLS). `supabase db push` output lists both migrations.
3. **Credentials** — After first sign-in you land on `/onboarding`. Paste an
   OpenAI or Anthropic key → *Save*: the key is round-tripped against the
   provider's models endpoint (a bogus key is rejected with the provider's
   message), then stored encrypted; the form shows `Connected · ····last4`.
   Rotate/remove later under `/settings`.
4. **Streaming** — In an empty conversation, type a prompt and press Enter.
   The pane becomes the canvas with one card; the response streams token by
   token into the card body. (Streamed text lives in a client store; the
   tldraw shape never sees intermediate tokens. The server flushes partials to
   Supabase every ~2s / 500 chars.)
5. **Canvas + persistence** — Drag a card, reload: the position survives
   (debounced write to `nodes.canvas_*`).
6. **Parent/child + arrows** — Click a suggestion chip to the right of a card:
   a child card is created below-right of its parent with a solid arrow that
   re-routes as you move either card.
7. **Suggestions + titles** — When a response completes, the utility model
   fills in the card title (≤6 words) and three chips. Both survive reload;
   a taken chip renders checked. A root card's title becomes the conversation
   title in the sidebar.
8. **Context picker** — Select a card, and the composer shows every ancestor
   with a checkbox, an approximate token count, and a running total (full
   path to root checked by default). Uncheck/check ancestors, submit, then
   select the new card: non-parent context sources render as **dashed**
   arrows; the parent edge stays solid. The sent set is stored in
   `context_edges` (topological order, oldest first).
9. **Overlay + errors** — Click a card's expand icon: full-pane overlay above
   the still-mounted canvas; Esc (or ✕) returns instantly with the camera
   preserved. Kill the dev server mid-stream and reload: the partial response
   is still on the card with an inline "generation was interrupted" notice and
   a *Retry* button (retry is a fresh attempt, never a splice).

Quality-bar checks that were run: `npx tsc --noEmit` and `npm run lint` are
clean; the client bundle greps clean for provider hostnames and key prefixes
(`grep -rE "api\.openai\.com|api\.anthropic\.com|sk-ant-|sk-proj-" .next/static/`);
Enter submits / Shift+Enter newline / Esc closes the overlay.

## Where this deviates from the spec

- **Utility-call temperature** — §3.7 asks for temperature near zero. Current
  reasoning models on both providers reject non-default sampling params, so
  temperature is omitted entirely; determinism is approximated with strict
  JSON schemas and low output budgets instead.
- **Cards are fixed-size** — the card view is fixed width per §3.3; resizing
  is disabled outright (expanded view is the overlay). `canvas_w/h` are
  persisted but currently always the defaults.
- **tldraw v5 API drift** (§2 version check): shape props are registered via
  TypeScript module augmentation (`TLGlobalShapePropsMap`), indicators are
  `getIndicatorPath(): Path2D`, and `editor.store.listen` never delivered
  entries in this build — geometry persistence uses
  `editor.sideEffects.registerAfterChangeHandler("shape", …)` instead.
- **Next 16** renamed `middleware.ts` → `proxy.ts` (exported function
  `proxy`); the Supabase session-refresh middleware lives there.
- **Suggestion regeneration** — suggestions are generated eagerly when a node
  completes. If that one utility call fails (e.g. network), the card simply
  has no chips; there is no retry-on-reload sweep.
- **Anthropic safety refusals** are surfaced as a card error (with Retry)
  rather than silently re-running on a fallback model — in a BYOK app the
  user's model choice is explicit, and the card footer reports the model that
  actually ran.
- **Edges are read-only by construction**: the tldraw UI is hidden (`hideUi`,
  which also disables tool keyboard shortcuts), so the arrow tool is
  unreachable; arrows are created programmatically, locked, and a
  before-delete side effect vetoes deletion of any shape.

## Out of scope (per spec §9)

Real-time multiplayer, sharing/permissions, mobile layout, file uploads, tool
use inside conversations, billing, node deletion/re-parenting UI, editing a
node's context after creation, dark mode polish.
