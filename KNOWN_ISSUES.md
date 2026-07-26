# Known issues

Open findings from the code review of 2026-07-26, kept here so they aren't
lost. The high-severity set (three security bugs, both data-loss paths, the
retry family, the always-500 RLS gap, the Anthropic truncation misreport, and
the `.gitignore` leak) has been fixed; everything below is still outstanding.

`npx tsc --noEmit`, `npx eslint .` and `npx next build` are all clean, so none
of these are visible to the existing checks — they are all runtime behaviour.

## Medium

### 1. Card geometry is lost if you leave within the debounce window
`components/canvas/Canvas.tsx:158`

The unmount cleanup clears the 600 ms geometry debounce timer without flushing
`pendingGeometry`. Drag a card and switch conversations (or reload) inside that
window and the position silently reverts — `ConversationView.tsx:44` returns
null on the conversationId mismatch, unmounting the editor and cancelling the
timer. This is the narrow case where README verification step 5 fails.

*Fix:* extract the flush body into a stable callback, call it from the cleanup
before `clearTimeout`, and add a `beforeunload` handler for the reload case.

### 2. Sign-up silently bounces back to /login when email confirmation is on
`app/login/page.tsx:28`

`signUp` is treated as fully authenticating: the code branches on `error` alone
and discards `data`. With email confirmation enabled — the Supabase default —
it returns `{user, session: null}`, no cookie is set, and `router.push("/c")`
is bounced straight back to /login by the proxy with no message. Works today
only because auto-confirm is enabled on the currently linked project (README
line 52), which is dashboard config, not anything in this repo.

*Fix:* branch on `data.session` and render a "check your email" state when null.

### 3. Duplicate context ids create a node and then delete it
`app/api/chat/route.ts` (context validation loop)

`contextNodeIds` is checked for membership but never deduplicated. `topoOrder`
preserves duplicates for independent nodes, so `[X, X]` reaches the
`context_edges` insert and trips `unique (node_id, source_node_id)`. The node
row has already been created by then, so it is created, the insert fails, the
node is deleted, and the caller gets a raw Postgres "duplicate key value"
string as a 400.

*Fix:* `[...new Set(contextNodeIds)]` before validation.

### 4. Composer has no in-flight guard; double-Enter stacks cards
`components/composer/Composer.tsx:74`

The Enter handler calls `submit()` on every keydown and is gated only by empty
text — `disabled={!prompt.trim()}` on the Send button does not cover the
keyboard path. Two submits inside one round trip both read the same node list,
so `childPosition` returns identical coordinates and one card is perfectly
hidden behind the other. Both consume API quota. `SuggestionRail.tsx:41`
already has the right pattern (`if (taken || busy) return`).

*Fix:* add a `busy` state, mirroring SuggestionRail.

### 5. Save spinner wedges permanently on a non-JSON error response
`components/settings/ProviderKeyForm.tsx:36`

`await res.json()` has no `.catch()` and runs before `setBusy(false)`. A 502
HTML page — or the unhandled 500 `encryptSecret` throws when
`APP_ENCRYPTION_KEY` is missing — rejects with a SyntaxError, so `setBusy(false)`
never runs: the button stays disabled and spinning with no error text, and only
a reload recovers. `remove()` on line 54 already guards correctly.

*Fix:* `.catch(() => ({}))` and wrap the body in try/finally.

### 6. Expanded-card overlay becomes undismissable
`components/canvas/ExpandedCardOverlay.tsx:37`

`if (!node) return null` bails before the Dialog renders while `expandedNodeId`
stays set. The only thing that clears it is `onOpenChange`, which lives inside
the Dialog that was just skipped — so Esc and ✕ do not exist. If the expanded
node leaves the store, clicking Expand on that card is then a no-op because
`setExpandedNode` writes the value it already holds.

*Fix:* clear `expandedNodeId` in an effect when the node is absent.

### 7. Conversations are created as a side effect of a GET render
`app/(app)/c/page.tsx:34`

The `/c` page INSERTs when no conversation exists, with no idempotency guard.
Two near-simultaneous requests both see `newest === null` and both insert,
leaving duplicate empty "New conversation" rows that never get cleaned up
(`touch_conversation` only fires on node insert, and there is no deletion
path). Also fragile against router prefetch if a `<Link href="/c">` is ever
added.

*Fix:* move the create behind a POST/Server Action, or make it idempotent.

## Low

### 8. Context-count rendering is O(N·E) per store write
`components/canvas/CardBody.tsx:21`

`s.edges.filter(...).length` runs for every mounted card on every store write —
a 50-card / 200-edge conversation does 10,000 comparisons per update, for a
value that is immutable after node creation. `ExpandedCardOverlay.tsx:28`,
`ContextPicker.tsx:27` (`ancestorsOf` + `topoOrder`, memoized on the `nodes`
object identity that `updateNodeGeometry` replaces on every drag frame) and
`Canvas.tsx:152` (`reconcile` re-walking all nodes inside `editor.run`) compound
it.

*Fix:* maintain `contextCountByNode: Record<string, number>` in `init`/`addEdges`.

### 9. Dark mode never activates and `useTheme` has no provider
`app/layout.tsx:30`

`globals.css:6` defines `@custom-variant dark (&:is(.dark *))` and lines 87-119
supply a full dark palette, but nothing ever adds `.dark` to the tree — so the
tokens and every `dark:` variant (including `dark:prose-invert`) are dead, and
users on a dark-mode OS get a light UI. Separately `components/ui/sonner.tsx:8`
calls `useTheme()` from next-themes with no `ThemeProvider` mounted; it doesn't
throw, but the `= "system"` default silently masks the missing provider.

README line 155 lists "dark mode polish" as out of scope, so this may be
deliberate — but the honest options are wiring the provider or deleting the
dead tokens, not leaving `useTheme` dangling.

### 10. `zod` unused; `shadcn` CLI in production dependencies
`package.json:28`

`zod` is imported nowhere in `app/ components/ lib/ hooks/`. `shadcn` is a
scaffolding CLI — but note `globals.css:3` does `@import "shadcn/tailwind.css"`,
so it is a genuine build-time need and belongs in `devDependencies`, not
`dependencies`.

*Fix:* move `shadcn` to devDependencies; drop `zod`, or use it — the Anthropic
SDK's `zodOutputFormat()` is exactly what the followups call should validate
with (see issue 12).

### 11. Duplicated blocks that will drift
`app/(app)/settings/page.tsx:7`

`settings/page.tsx:6-13,24-30` and `onboarding/page.tsx:9-16,30-36` are the same
eight lines twice. `CardBody.tsx:35-38,91-106` and
`ExpandedCardOverlay.tsx:39-42,66-80` each re-derive the streaming-vs-stored
response text and re-hand-roll the interrupted/Retry block with different
markup — which is why the Retry busy-guard fix (issue 4's sibling) has to be
made in two places.

*Fix:* extract `<ProviderKeyList/>`, a `useNodeResponseText(nodeId)` hook, and a
shared `<InterruptedNotice/>`.

### 12. Hand-rolled JSON parsing where the SDK offers a typed parser
`lib/providers/anthropic.ts:80`

`node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts:36-52`
documents `messages.parse({..., output_config: {format}})` returning a typed
`parsed_output`. The hand-rolled path is longer and more fragile:
`content.find((b) => b.type === "text")` silently picks the first text block
(thinking/tool blocks shift it), and the bare `JSON.parse` throws an opaque
SyntaxError that surfaces as a generic 502. Same for `openai.ts:88`
`JSON.parse(res.output_text)`, which throws on empty output when the 2000-token
budget is spent on reasoning — unlike `streamChat`, `generateFollowups` never
checks for an incomplete response.

### 13. README overstates composer model selection
`README.md:74`

"The conversation model is user-selected in the composer" — in fact
`Composer.tsx:203` maps over connected *providers*, one entry each, and always
sends `MODELS[provider].conversation`; `api/chat/route.ts` then rejects anything
else. There is exactly one conversation model per provider and no model
dropdown. `lib/providers/models.ts:2` repeats the same claim.
