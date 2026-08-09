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
3. **Audio previews** — Spotify deprecated `preview_url` (Nov 2024) and now returns `null` for *every* track on Client Credentials — measured 0/20 across four markets, which is why `Track` carries no `previewUrl` field at all. Every clip the game plays comes from iTunes or Deezer, resolved through `lib/preview-client.ts`. On mount it prefetches the whole game with one `POST /api/preview/batch`; anything that comes back unresolved falls back to `GET /api/preview` lazily, at the moment the host presses Play. Both search the **iTunes Search API** first and fall back to **Deezer**. Settled results are cached per track id in a ref (`previewCache`); tracks with no clip anywhere show a "no audio" state.

### API Routes (the only server code)

| Route | Purpose |
|---|---|
| `POST /api/playlist` | `{url}` → playlist name + tracks, via Spotify **Client Credentials** flow (`lib/spotify.ts`). Rejects Spotify editorial playlists (IDs starting `37i9` return 404 for new apps). |
| `GET /api/preview` | Track/artist/id → 30s preview URL (iTunes, then Deezer). No auth required. KV-cached by track id, including negative results. `&refresh=1` re-resolves a URL that stopped playing, on its own much tighter limit. |
| `POST /api/preview/batch` | `{tracks:[{id,name,artist}]}` → the same lookup for a whole game in one request. |
| `POST /api/room` | Creates a Mixed Playlist Mode room; returns room code, host token, expiry. |
| `POST /api/room/[code]/submit` | A player submits their playlist URL to the room. |
| `GET /api/room/[code]/status` | Poll for who has submitted so far. |
| `GET /api/room/[code]/pool` | Host consumes the room and gets the sampled, deduped track pool. |

**Every route is IP rate limited** via `lib/rate-limit.ts` (fixed window on top of `lib/kv.ts`'s atomic `incr`). When adding a route, follow the existing pattern: module-level `X_LIMIT` / `X_WINDOW_SECONDS` constants, then `rateLimit()` → 429 before any expensive work.

Three caches keep upstream request volume flat as traffic grows:
- **Preview cache** (`lib/preview-cache.ts`) — KV, keyed by track id. Caching misses is the point: tracks with no preview anywhere are the most repeatedly queried, and each uncached miss costs 5 upstream calls. See "Previews are per-track" below, which is the whole reason this is the hottest path in the app.
- **Playlist cache** (`lib/playlist-cache.ts`) — KV, keyed by playlist id. 6h on a full playlist, 1h on a sampled one. **Every caller must go through `loadPlaylist`, never `getPlaylistWithTracks` directly** — a single uncached path is enough to put the shared quota back at risk.
- **Spotify token cache** (`lib/spotify.ts`) — module scope, so per-lambda-instance rather than global. Deliberately *not* in KV: a token is the one thing with no fallback, so a KV outage on that path would take down playlist loading entirely. A 401 clears the cache and retries once.

### Spotify's quota is per app, not per IP

This is the constraint the whole playlist path is shaped around, and it is the opposite of how `lib/rate-limit.ts` works. Spotify throttles on the **client id**, so every visitor shares one budget, while every route limiter is keyed by IP and hands each new visitor a fresh allowance. Per-IP limits bound one abusive client; they do nothing about aggregate load. `lib/playlist-cache.ts` is what bounds the aggregate, in three layers:

- **Cache** — a repeat playlist costs zero upstream calls.
- **In-flight coalescing** — concurrent loads of the same playlist collapse into one fetch, per lambda instance. Mixed mode fires one request per contributor from one click, and a QR room gets a burst of simultaneous submits; the cache write lands too late to help those siblings.
- **Global budget** (`SPOTIFY_MAX_LOADS_PER_MINUTE`) — a KV `incr` counter shared across instances, refusing new playlists *before* Spotify does. Fails open on a KV error: losing the safety net must mean "back to how it was", not "nobody can play".
- **429 cooldown** — when Spotify does refuse, all uncached loads are parked for `Retry-After` (clamped 30s–15min), in KV so every instance sees it. Without this a throttled window is self-sustaining: every host errors, every host retries, the retries keep the quota pinned. Cached playlists keep serving throughout, so a party mid-game is unaffected by someone else's throttling.

Two rules that follow from this, and are easy to undo by accident:
- **Never flatten an upstream 429 into a generic 400.** The client has to be able to tell "your playlist is wrong" from "we are throttled" — the original bug told throttled hosts to check their URL was public, which sent them straight back into retrying.
- **`fetchPlaylistTracks` reads at most `MAX_PLAYLIST_TRACKS` (500), sampling random pages when a playlist is bigger.** Following `next` unbounded made one big playlist cost 40+ requests for a game that plays at most 50 songs. Cache hit rate is logged on every miss (`[playlist-cache] miss id=… source=… hits=… negative=… misses=… rate=…`) and readable via `getCacheStats()`.

Two things about reading that line, both of which have already cost a debugging detour:
- **Trust `source=`, not the log row's method.** Only `POST /api/playlist` and `POST /api/room/[code]/submit` can produce it, but Vercel attributes a line to whichever request the instance was serving, so it often appears against an unrelated `GET`. New callers of `loadPlaylist` should pass a `PlaylistLoadSource`; the default logs `source=unknown`.
- **`rate` counts a replayed 404 as a hit** — correctly, since it answered without touching Spotify — so a host retrying a dead link pushes it *up*. `negative=` is that subset, and `hits - negative` is the part that describes real playlists. The bucket is a **UTC** day, so a rate read soon after 00:00 UTC is measuring almost nothing.

### Previews are per-track, which makes them the hotter path

`lib/preview-cache.ts` is the same shape of problem as the section above, an order of magnitude worse. Spotify is called once per *playlist*; iTunes and Deezer are called once per *track*, so a cold 50-song game is 50 lookups of up to 5 upstream calls each. Both throttle per IP, and a serverless deploy's egress IPs are shared — from iTunes' side the entire user base is one very noisy client. Per-IP limiting does nothing about it, for the reason spelled out above.

The same three layers, so they read the same way: cache → global budget (`PREVIEW_MAX_LOOKUPS_PER_MINUTE`, counted in *lookups*) → per-source cooldown, all fail-open, all in KV so every instance sees them. `[preview-cache] miss hits=… misses=… unavailable=… rate=…`, readable via `getPreviewCacheStats()`.

Four things here are easy to undo by accident:

- **The title-only queries verify the artist; the ones that carried it upstream must not.** Each source is asked progressively looser questions and the last drops the artist, so upstream ranks by popularity alone and returns the best-known song with that title — iTunes answers "Hello" with Pinkfong's nursery rhyme and "Alone" with Heart. Accepting one caches the wrong recording as `found` for a year, which refresh never re-picks, and the clip then contradicts the answer card. Those queries require the candidate to be tied to the request by *either* a matching credit or a matching running time, and otherwise hand over to the next source. Applying the same check to the artist-carrying queries looks like an obvious tightening and is a catalogue-wide outage for CJK: iTunes returns 小幸運 as "A Little Happiness" by "Hebe Tien" where Spotify says 田馥甄. `artistMatches` is only ever a veto where upstream had no artist signal of its own.

- **`absent` and `unavailable` are not the same null, and collapsing them is a real bug that shipped.** `absent` is a fact about the recording — nothing has a clip — and is cached a week. `unavailable` is a fact about *us*: throttled, out of budget, or the request never got through. The old route mapped every failure onto `previewUrl: null` and cached it for seven days, so one throttled minute at peak marked a slice of the catalogue silent for a week, and it never reproduced locally because a laptop's own IP is never the one being throttled. Only a clean, complete reply from upstream may produce `absent`; everything else is `unavailable`, cached 90 seconds. A wrong `absent` lasts a week and is invisible, a wrong `unavailable` costs one retry. **The client half has the same rule** (`lib/preview-client.ts`, and `previewCache` in the game page stores settled answers only).
- **iTunes signals throttling with `403`, not 429, and Deezer puts its quota error in the body of a `200`.** Reading only 429, or only the status, is how a refusal gets classified as "no result" in the first place.
- **The cache key is deliberately unversioned**, unlike `lib/playlist-cache.ts`'s. The record is a strict superset of the `{previewUrl}` shape that shipped before it, so legacy entries still read as valid hits. Bumping a version would cold-start every entry in production simultaneously — precisely the upstream burst the module exists to prevent. For the same reason, legacy nulls are read as `absent` even though some are poisoned by the old bug: they age out within a week, and re-resolving all of them at once is the stampede that poisoned them.

Positive entries are held a year, because a recording does not change. What does change is the URL — the clips sit on a CDN that rotates them — so the entry has to be *repairable* rather than merely expiring: the stored `itunesTrackId` lets `&refresh=1` re-resolve with one `lookup?id=` call instead of the five-call search fan-out, and the game page fires it from the `<audio>` element's `error` event, once per track. Drop the refresh path and the year-long TTL becomes a year of dead URLs.

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
SPOTIFY_MAX_LOADS_PER_MINUTE                # Optional — global upstream ceiling, default 40
PREVIEW_MAX_LOOKUPS_PER_MINUTE              # Optional — global iTunes/Deezer ceiling, default 120
```

Without the Upstash pair, `lib/kv.ts` falls back to an in-process `Map`. That is fine for `next dev` and tests, but **not** for multi-instance serverless deploys: rooms created by one lambda would be invisible to another, rate limit counters would reset per instance, and the preview cache would lose most of its hit rate.

## Release Notes — two changelogs, both hand-written

A release updates **both** of these, and they are not the same document:

- `CHANGELOG.md` — the maintainer's record. Technical, names files and functions, carries a "Known gaps" todo list.
- `lib/changelog.ts` — what players read in the footer's "What's new" overlay (`components/changelog-modal.tsx`, on `/`, `/about`, `/zh`). Plain language, and **bilingual**: every entry needs `text` *and* `textZh`, plus `headline` and `headlineZh`. `/zh` is written natively rather than translated, so an English string leaking through there is a visible defect, not a fallback.

`tests/changelog.test.ts` enforces what it can: newest-first ordering, both languages present and different, valid dates, no markdown, and `LATEST_VERSION === package.json`'s version. That last one means **bumping `package.json` without adding an entry to `lib/changelog.ts` fails the suite** — deliberately, because the overlay prints that version to users and `changelog_opened` files reads under it.

## Error messages — codes, not sentences

`lib/error-messages.ts` is the only place a user-visible error string exists: one `AppErrorCode` union and one `Record<AppErrorCode, {en, zh}>` table, so a missing translation is a compile error. Add an error by adding a code, never by writing a sentence at the throw site.

**The server sends `{ error, code }` and the client picks the language.** Routes build that with `errorResponse` (`lib/api-error.ts`); `SpotifyApiError`, `RoomError` and `BuzzerUnavailableError` are constructed from a code, and their `message` is the English rendering — it is for `console.error`, never for the UI. Localising server-side would be wrong three ways: one room is read by several devices, `/api/playlist` is called on behalf of other people's phones in Mixed mode, and `lib/playlist-cache.ts` caches 404s, which would freeze one language into the cache for everyone.

Clients render with `errorMessage` / `describeError` and get the locale from `useErrorLocale()` (device language, resolved in an effect so the server-rendered join pages don't hydrate against a different string). `apiError(body, fallbackCode)` turns a failed response into an `AppError`; the fallback should name what the caller was doing, not `unknown`.

Two things `tests/error-messages.test.ts` will catch, both easy to do by accident:
- **A placeholder only exists if its callers pass params.** `{seconds}` with no `params` renders literally at the player, so the test pins the exact set of codes allowed to have one.
- **No throttling message may blame the host's playlist**, in *either* language. That is the `spotify_*` hazard documented above, and a translation is just as capable of reintroducing it.

The buzzer Worker keeps its own wire codes (`BuzzerErrorCode` in `lib/buzzer-protocol.ts`, which is shared verbatim with the Worker and must stay dependency-free). `BUZZER_ERROR_CODES` maps them onto app codes — that mapping is the only thing connecting the two, so a new wire code needs an entry there.

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

`types/index.ts` contains only the `Track` interface — the shape stored in sessionStorage and returned by `/api/playlist`. Shared game types (`GamePayload`, `GamePlayer`, `GameMode`) live in `lib/game-session.ts`; room types and constants (`ROOM_TTL_SECONDS`, `ROOM_MAX_SUBMISSIONS`) live in `types/room.ts`; preview wire types and `PREVIEW_BATCH_MAX` live in `types/preview.ts`, kept out of `lib/preview-cache.ts` so the browser bundle doesn't pull in `lib/kv.ts` and the Upstash client; the game page defines its own local `Phase` type.

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
