# 🫟 Splat

Chat with an LLM on an infinite canvas instead of in a scrolling transcript.

Every prompt/response pair is a **card**, and cards link into a directed graph.
When you write a new prompt you pick — with checkboxes — exactly which ancestor
cards get sent as context. A linear thread makes you choose between polluting
your context with a tangent and losing the tangent entirely; on a graph you just
branch, and pull context from whichever branches turned out to be relevant.

**BYOK** — bring your own OpenAI, Anthropic, or OpenRouter key. There's no hosted
tier. Keys are encrypted at rest and only ever decrypted inside a route handler.

## Run it locally

You'll need Node 20+, a free [Supabase](https://supabase.com) project, and an API
key from at least one provider.

```sh
git clone https://github.com/akorman128/Splat.git
cd Splat
npm install
cp .env.example .env.local
```

Fill in four values in `.env.local`:

| Variable | Where it comes from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page — the publishable (anon) key |
| `APP_ENCRYPTION_KEY` | Generate one: `openssl rand -base64 32` |
| `SUPABASE_PROJECT_ID` | The project ref — the subdomain of the URL above |

Push the schema, then start:

```sh
supabase link --project-ref <project-ref>
supabase db push
npm run dev          # → http://localhost:3000
```

Sign up with email + password, paste a provider key on the onboarding screen, and
you're in.

## How to use it

- **Write a prompt** in the composer, pick a provider, and send. You get a card.
- **Branch** by clicking a suggestion chip on a card, or by starting a new prompt
  and checking the ancestors you want as context. Unchecked ancestors aren't sent.
- **Attach files** by dropping them on the canvas, pasting, or using the
  paperclip. They appear in the context picker, nested under the card that owns
  them.
- **Use a skill** — a reusable block of instructions, managed in the sidebar — by
  typing `/` in the prompt box. It's sent as system instructions, not as part of
  your prompt.
- **Share** a conversation from its ⋯ menu. The link is read-only, and *Stop
  sharing* revokes it.

## Contributing

Issues and PRs are welcome — including "this confused me" reports. Claim
something by opening an issue first.

There's no CI yet, so run these locally before sending a PR:

```sh
npx tsc --noEmit
npm run lint
```

House style: no comments unless the code genuinely can't explain itself. Match
what's around you.

## License

[MIT](LICENSE)
