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

**GuessSong** — a local party music guessing game built on **Next.js 15 App Router**. The host pastes a public Spotify playlist URL, adds player names, and plays short audio clips; everyone guesses out loud and the host awards points. No login, no database — all game state lives in React state, handed off between pages via `sessionStorage`.

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
| `GET /api/preview` | Track/artist → 30s preview URL (iTunes, then Deezer). No auth required. |

### Scoring

The host is the judge — there is no automated answer checking. Correct song guess = host taps the player → **+3 pts**; album name = **+1 pt**. One award of each type per round, guarded by `pointsAwarded` / `albumPointsAwarded` flags. Note: `lib/game-logic.ts` (`isAnswerCorrect`, answer normalization) is currently **unused** — it's a leftover from the old text-input flow.

### SEO / Metadata

Production domain is `https://www.guessong.app` (fallback in `app/layout.tsx`, `app/sitemap.ts`, `app/robots.ts`). `app/layout.tsx` also injects GA4 when `NEXT_PUBLIC_GA_MEASUREMENT_ID` is set. `app/opengraph-image.tsx` and `app/icon.tsx` generate images at build time.

## Environment Variables

```
SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET   # Required — Client Credentials only, no redirect URI
NEXT_PUBLIC_BASE_URL                        # Optional — defaults to https://www.guessong.app
NEXT_PUBLIC_GA_MEASUREMENT_ID               # Optional — enables GA4
```

## Styling Conventions

- Dark aesthetic: background `#111`, cards `#1a1a1a`, Spotify green `#1DB954` accents
- Fonts: Bebas Neue (display) + Outfit (body), loaded via inline `<style>` in the pages
- The setup and game pages use **inline styles and `<style>` blocks**, not Tailwind classes — match this when editing them. Tailwind + shadcn/ui (`components/ui/`: button, card, input, label) are used elsewhere.

## Types

`types/index.ts` contains only the `Track` interface — the shape stored in sessionStorage and returned by `/api/playlist`. Shared game types (`GamePayload`, `GamePlayer`, `GameMode`) live in `lib/game-session.ts`; the game page defines its own local `Phase` type.

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
