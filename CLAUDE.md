# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start dev server on port 8000 (http://127.0.0.1:8000)
npm run build      # Production build
npm run start      # Start production server
npm run lint       # Run ESLint
```

> Spotify OAuth requires `http://127.0.0.1:8000` specifically — do not use `localhost`.

## Architecture

**Next.js 15 App Router** multiplayer music guessing game using KKBOX playlists. Hosts create rooms from KKBOX playlists (no login required); players join via 6-character room code or QR code.

### Route Groups

- `app/(marketing)/` — Public landing/join page
- `app/(app)/` — Protected pages (dashboard, room host view, create room)
- `app/rooms/[code]/` — Public room pages (join, summary)
- `app/api/` — REST API routes for room/round lifecycle

### Data Flow

1. Host creates a room via `POST /api/rooms` → fetches tracks from KKBOX API (`lib/kkbox.ts`)
2. Room state syncs in real-time via **Supabase Realtime** subscriptions
3. Host controls rounds via `/api/rooms/[code]/rounds/start` and `/api/rounds/[id]/finish`
4. Players submit guesses via `POST /api/rounds/[id]/guess`
5. Answer validation uses `lib/game-logic.ts` (normalizes text: strips brackets, "feat.", punctuation, etc.)

### Key Libraries

| File | Purpose |
|------|---------|
| `lib/kkbox.ts` | KKBOX API client — primary music source |
| `lib/auth.ts` | NextAuth config with Spotify OAuth |
| `lib/supabase.ts` | Supabase client (standard + admin service role) |
| `lib/config.ts` | Centralized URL helpers (`getBaseUrl()`, `getCallbackUrl()`) |
| `lib/game-logic.ts` | Answer normalization and validation logic |

### Database

Supabase (PostgreSQL + Realtime). Migrations in `supabase/migrations/`:
- `001` — Core tables: `rooms`, `rounds`, `room_players`, `tracks`
- `002` — Row Level Security policies
- `003` — `preview_url` column on tracks
- `004` — Anonymous player support
- `005` — KKBOX migration (replaces Spotify track source)

### Environment Variables

```
KKBOX_CLIENT_ID / KKBOX_CLIENT_SECRET
NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXTAUTH_SECRET / NEXTAUTH_URL / NEXT_PUBLIC_BASE_URL
SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET   # Legacy/auth only
```

### UI

shadcn/ui components in `components/ui/`. Game-specific components in `components/game/`. Session wrapped via `components/providers/SessionProviderWrapper.tsx`.

### Types

All shared TypeScript types in `types/`. Key enums:
- `RoomStatus`: `"lobby" | "playing" | "ended"`
- `RoundStatus`: `"pending" | "active" | "finished"`
- `GameMode`: `"audio" | "lyrics"`
