# GuessSong

A local party music guessing game powered by Spotify playlists.

## How It Works

1. **Setup** — Paste any public Spotify playlist URL (or pick a built-in trial playlist), add player names, choose a clip length (5–30s) and song count, and hit Start
2. **Play** — A short audio clip plays; everyone guesses the song out loud
3. **Score** — The host picks who got it right (+3 pts for song, +1 pt for album)
4. **Finish** — Final scoreboard with a shareable results image

No login required. Works entirely in the browser.

### Mixed Playlist Mode

Instead of one playlist, merge everyone's playlists into a shared pool:

- **Room mode** — the host shows a QR code, players scan it and submit their own playlist URL from their phone, the host pulls in the pooled tracks once everyone's in
- **Phone mode** — pass one phone around and add each player's playlist directly

Pooled tracks are deduped across submissions and sampled so every contributor is fairly represented. A round-scoring history feeds a shareable "group taste card" at the end (most obscure picks, most mainstream picks, most shared tracks).

## Features

- Spotify playlist import (Client Credentials, no user auth)
- Built-in, preview-verified trial playlists for a no-setup demo game
- Mixed Playlist Mode — QR-code room or single-phone collection, with fair per-contributor sampling
- 30s audio previews via iTunes Search API (Deezer fallback)
- Blurred album art hint system
- Real-time progress bar + countdown during playback
- Replay clip from guessing phase
- Export final scores (and, in Mixed Playlist Mode, a group taste card) as a PNG
- Installable as a PWA, with Android Web Share Target support for sharing a Spotify playlist link straight into the app
- Mobile-friendly layout

## Stack

- [Next.js 15](https://nextjs.org/) App Router
- TypeScript + Tailwind CSS
- [shadcn/ui](https://ui.shadcn.com/) components
- Spotify Web API (Client Credentials)
- iTunes Search API for audio previews
- [Upstash Redis](https://upstash.com/) for the Mixed Playlist Mode room store (falls back to in-memory locally)
- [Vitest](https://vitest.dev/) for unit tests

## Getting Started

### 1. Clone & install

```bash
git clone https://github.com/Waynting/GuessSong.git
cd GuessSong
npm install
```

### 2. Set up environment variables

Copy `.env.example` to `.env.local` and fill in the values:

```bash
cp .env.example .env.local
```

```env
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret

# Optional — defaults to https://www.guessong.app
NEXT_PUBLIC_BASE_URL=

# Optional — enables GA4 when set
NEXT_PUBLIC_GA_MEASUREMENT_ID=

# Optional — only needed for production deploys, see note below
UPSTASH_REDIS_REST_URL=your_upstash_redis_rest_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_rest_token
```

`SPOTIFY_CLIENT_ID`/`SECRET` are app-level Client Credentials, not user login — there's no redirect URI and players never see a Spotify sign-in screen. They're required whenever the app fetches a playlist you paste in (single-playlist mode, or Mixed Playlist Mode's room/phone submissions), since `/api/playlist` calls Spotify's Web API and needs them to authenticate. If you just want to try the 3 built-in trial playlists, you can skip these — those are bundled locally and never call Spotify. Get credentials at [developer.spotify.com](https://developer.spotify.com/dashboard) — create an app and copy the Client ID and Secret.

`UPSTASH_REDIS_REST_URL`/`TOKEN` back the QR-code room store used by Mixed Playlist Mode (`lib/kv.ts`) and its rate limiting (`lib/rate-limit.ts`). Leave them unset for local dev — the app falls back to an in-memory store that works fine on a single `next dev` process. **On a serverless/multi-instance deploy (e.g. Vercel) you must set these**, otherwise a room created on one instance can be invisible to a request that lands on another. Get a free database at [upstash.com](https://upstash.com).

### 3. Run the dev server

```bash
npm run dev
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

> **Note:** Use `127.0.0.1:8000` specifically — the Spotify app is configured for this origin.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server on port 8000 |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm test` | Run the Vitest suite (`tests/`) |

## Gameplay Notes

- **Audio previews** — Spotify no longer provides preview URLs for most tracks (deprecated Nov 2024). The app falls back to the iTunes Search API to find a matching 30s preview. A small number of tracks may have no preview available.
- **Playlists** — Use public playlists you created. Spotify editorial playlists (Discover Weekly, etc.) are not supported since those IDs return 404 for new apps.
- **Scoring** — The host is the judge. No automated answer checking — players guess verbally and the host awards points.
- **Found a bug?** — Use the "Report a problem" link in the footer to email the maintainer directly.
