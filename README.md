# GuessSong

A local party music guessing game powered by Spotify playlists.

## How It Works

1. **Setup** — Paste any public Spotify playlist URL, add player names, choose a clip length (5–30s), and hit Start
2. **Play** — A short audio clip plays; everyone guesses the song out loud
3. **Score** — The host picks who got it right (+3 pts for song, +1 pt for album)
4. **Finish** — Final scoreboard with a shareable results image

No login required. Works entirely in the browser.

## Features

- Spotify playlist import (Client Credentials, no user auth)
- 30s audio previews via iTunes Search API (Deezer fallback)
- Blurred album art hint system
- Real-time progress bar + countdown during playback
- Replay clip from guessing phase
- Export final scores as PNG
- Mobile-friendly layout

## Stack

- [Next.js 15](https://nextjs.org/) App Router
- TypeScript + Tailwind CSS
- [shadcn/ui](https://ui.shadcn.com/) components
- Spotify Web API (Client Credentials)
- iTunes Search API for audio previews

## Getting Started

### 1. Clone & install

```bash
git clone https://github.com/Waynting/spotify-song-guess_web.git
cd spotify-song-guess_web
npm install
```

### 2. Set up environment variables

Create a `.env.local` file:

```env
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret

# Optional — only needed for production deploys, see note below
UPSTASH_REDIS_REST_URL=your_upstash_redis_rest_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_rest_token
```

Get Spotify credentials at [developer.spotify.com](https://developer.spotify.com/dashboard) — create an app and copy the Client ID and Secret. No redirect URI needed (Client Credentials flow only).

`UPSTASH_REDIS_REST_URL`/`TOKEN` back the QR-code room store used by Mixed Playlist Mode (`lib/kv.ts`). Leave them unset for local dev — the app falls back to an in-memory store that works fine on a single `next dev` process. **On a serverless/multi-instance deploy (e.g. Vercel) you must set these**, otherwise a room created on one instance can be invisible to a request that lands on another. Get a free database at [upstash.com](https://upstash.com).

### 3. Run the dev server

```bash
npm run dev
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

> **Note:** Use `127.0.0.1:8000` specifically — Spotify OAuth is configured for this origin.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server on port 8000 |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |

## Gameplay Notes

- **Audio previews** — Spotify no longer provides preview URLs for most tracks (deprecated Nov 2024). The app falls back to the iTunes Search API to find a matching 30s preview. A small number of tracks may have no preview available.
- **Playlists** — Use public playlists you created. Spotify editorial playlists (Discover Weekly, etc.) are not supported.
- **Scoring** — The host is the judge. No automated answer checking — players guess verbally and the host awards points.
