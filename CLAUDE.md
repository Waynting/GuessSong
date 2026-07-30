# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start dev server on port 8000 (http://127.0.0.1:8000)
npm run build      # Production build
npm run start      # Start production server
npm run lint       # Run ESLint
npm test           # Run vitest suite (tests/)
```

Use `127.0.0.1:8000` (not `localhost`) — the Spotify app is configured for this origin.

## What This Is

**GuessSong** — a local party music guessing game built on **Next.js 15 App Router**. The host pastes a public Spotify playlist URL, adds player names, and plays short audio clips; everyone guesses out loud and the host awards points. **No login and no user accounts** — a single game's state lives in React state, handed off between pages via `sessionStorage`.

There *is* server-side storage, but it is deliberately narrow: a KV layer (`lib/kv.ts`) backed by Upstash Redis, used only for short-lived, TTL'd data — Mixed Playlist Mode's rooms (`lib/room.ts`) and IP rate limiting (`lib/rate-limit.ts`). Nothing is persisted per-user, and there are no tables or migrations. Local dev and tests fall back to an in-process `Map`, so neither needs a real Redis.

## Architecture

### Data Flow

1. **Setup** (`app/page.tsx`) — collects playlist URL, player names, clip duration (5–30s). On Start, calls `POST /api/playlist`, shuffles the returned tracks, writes the whole game payload to `sessionStorage` under the key `guesssong_game`, then navigates to `/game`.
2. **Game** (`app/game/page.tsx`, ~1200 lines, the heart of the app) — reads `guesssong_game` from sessionStorage on mount (redirects to `/` if absent) and runs a phase state machine:
   `waiting → playing → guessing → revealed → (next track | finished)`
3. **Audio previews** — Spotify deprecated `preview_url` for most tracks (Nov 2024), so when a track has none, the game page fetches `GET /api/preview?track=&artist=`, which searches the **iTunes Search API** first and falls back to **Deezer**. Results are cached per track id in a ref (`previewCache`). Tracks with no preview anywhere show a "no audio" state.

### API Routes (the only server code)

| Route | Purpose |
|---|---|
| `POST /api/playlist` | `{url}` → playlist name + tracks, via Spotify **Client Credentials** flow (`lib/spotify.ts`). Rejects Spotify editorial playlists (IDs starting `37i9` return 404 for new apps). |
| `GET /api/preview` | Track/artist/id → 30s preview URL (iTunes, then Deezer). No auth required. KV-cached by track id, including negative results. |
| `POST /api/room` | Creates a Mixed Playlist Mode room; returns room code, host token, expiry. |
| `POST /api/room/[code]/submit` | A player submits their playlist URL to the room. |
| `GET /api/room/[code]/status` | Poll for who has submitted so far. |
| `POST /api/room/[code]/pool` | Host consumes the room and gets the sampled, deduped track pool. |

**Every route is IP rate limited** via `lib/rate-limit.ts` (fixed window on top of `lib/kv.ts`'s atomic `incr`). When adding a route, follow the existing pattern: module-level `X_LIMIT` / `X_WINDOW_SECONDS` constants, then `rateLimit()` → 429 before any expensive work.

Two caches keep upstream request volume flat as traffic grows, both of which matter because serverless egress IPs are shared and upstream APIs throttle per IP:
- **Preview cache** (`app/api/preview/route.ts`) — KV, keyed by Spotify track id. Hits live 30 days, misses 7. Caching misses is the point: tracks with no preview anywhere are the most repeatedly queried, and each uncached miss costs 5 upstream calls.
- **Spotify token cache** (`lib/spotify.ts`) — module scope, so per-lambda-instance rather than global. Deliberately *not* in KV, so `/api/playlist` keeps zero KV dependency and can't be taken down by an Upstash outage. A 401 clears the cache and retries once.

### Scoring

The host is the judge — there is no automated answer checking. Correct song guess = host taps the player → **+3 pts**; album name = **+1 pt**. One award of each type per round, guarded by `pointsAwarded` / `albumPointsAwarded` flags.

### SEO / Metadata

Production domain is `https://www.guessong.app` (fallback in `app/layout.tsx`, `app/sitemap.ts`, `app/robots.ts`). `app/layout.tsx` also injects GA4 when `NEXT_PUBLIC_GA_MEASUREMENT_ID` is set. `app/opengraph-image.tsx` and `app/icon.tsx` generate images at build time.

## Environment Variables

```
SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET   # Required — Client Credentials only, no redirect URI
UPSTASH_REDIS_REST_URL / _TOKEN             # Required in production — see below
NEXT_PUBLIC_BASE_URL                        # Optional — defaults to https://www.guessong.app
NEXT_PUBLIC_GA_MEASUREMENT_ID               # Optional — enables GA4
```

Without the Upstash pair, `lib/kv.ts` falls back to an in-process `Map`. That is fine for `next dev` and tests, but **not** for multi-instance serverless deploys: rooms created by one lambda would be invisible to another, rate limit counters would reset per instance, and the preview cache would lose most of its hit rate.

## Release Notes — two changelogs, both hand-written

A release updates **both** of these, and they are not the same document:

- `CHANGELOG.md` — the maintainer's record. Technical, names files and functions, carries a "Known gaps" todo list.
- `lib/changelog.ts` — what players read in the footer's "What's new" overlay (`components/changelog-modal.tsx`, on `/`, `/about`, `/zh`). Plain language, and **bilingual**: every entry needs `text` *and* `textZh`, plus `headline` and `headlineZh`. `/zh` is written natively rather than translated, so an English string leaking through there is a visible defect, not a fallback.

`tests/changelog.test.ts` enforces what it can: newest-first ordering, both languages present and different, valid dates, no markdown, and `LATEST_VERSION === package.json`'s version. That last one means **bumping `package.json` without adding an entry to `lib/changelog.ts` fails the suite** — deliberately, because the overlay prints that version to users and `changelog_opened` files reads under it.

## Analytics

`lib/analytics.ts` is the only place GA4 events are declared: one `AnalyticsEvent` union locking every event name to its param shape, and `trackEvent()`, which no-ops outside production (logging to `console.debug` instead) and when `window.gtag` is missing. Add an event by extending the union — never call `window.gtag` directly.

Two conventions worth keeping:

- **Failure params are bucketed enums, never raw error messages.** Messages come from upstream APIs and from pasted playlist URLs, so forwarding them would blow up GA4's param cardinality and could carry user input into analytics.
- **Every funnel needs a denominator.** `room_join_opened` exists so a QR code that people scan but fail to get through is distinguishable from one nobody scanned. Pure helpers that shape params (e.g. `roomJobs()`) live here rather than in the calling component, because the test suite only reaches `lib/`.

New params do not appear in GA4 reports until they are registered as custom dimensions (Admin → Custom definitions, scope **Event**), and registration is not retroactive.

## Styling Conventions

- Dark aesthetic: background `#111`, cards `#1a1a1a`, Spotify green `#1DB954` accents
- Fonts: Bebas Neue (display) + Outfit (body), loaded via inline `<style>` in the pages
- The setup and game pages use **inline styles and `<style>` blocks**, not Tailwind classes — match this when editing them. Tailwind + shadcn/ui (`components/ui/`: button, card, input, label) are used elsewhere.

## Types

`types/index.ts` contains only the `Track` interface — the shape stored in sessionStorage and returned by `/api/playlist`. Shared game types (`GamePayload`, `GamePlayer`, `GameMode`) live in `lib/game-session.ts`; room types and constants (`ROOM_TTL_SECONDS`, `ROOM_MAX_SUBMISSIONS`) live in `types/room.ts`; the game page defines its own local `Phase` type.

When adding a value to a union that `parseGamePayload` reads, add a type guard alongside it. The existing `mode` line falls back to `"party"` for anything unrecognised, so a new mode would be silently downgraded rather than rejected — follow the `isPlaylistSource` pattern one line above instead.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
