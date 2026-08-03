/**
 * Resolves a 30s preview clip for a track, since Spotify stopped populating
 * preview_url for most tracks in Nov 2024. Tries iTunes first, then Deezer.
 *
 * Every cache miss costs up to five upstream requests (2 iTunes queries, then
 * 3 Deezer queries). Serverless egress IPs are shared across all traffic, so
 * from iTunes' perspective the entire user base looks like one very noisy
 * client — and its per-IP throttling turns into `previewUrl: null`, which the
 * game renders as "this song has no audio". The bug therefore looks like a
 * catalogue gap rather than throttling, and never reproduces locally.
 *
 * The KV cache in front is what stops that from scaling with traffic:
 *
 *   request ─→ KV lookup ─┬─ hit  ─→ return (zero upstream calls)
 *                         │
 *                         └─ miss ─→ iTunes ×2 ─→ Deezer ×3 ─→ store ─→ return
 *
 * Misses are cached too. Tracks with genuinely no preview anywhere are the
 * ones queried most repeatedly, and without a negative entry each of those
 * replays all five upstream calls every single time.
 */

import { NextRequest, NextResponse } from "next/server";
import { getKvStore } from "@/lib/kv";
import { enforceRateLimit } from "@/lib/rate-limit";

/** Roughly one lookup per unique track; the client also caches per session. */
const PREVIEW_LIMIT = 300;
const PREVIEW_WINDOW_SECONDS = 10 * 60;

/** Recordings don't change, so a hit can be held for a long time. */
const HIT_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Shorter, so a track that gains a preview later isn't written off forever. */
const MISS_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Wrapper object rather than a bare `string | null`: KvStore.get returns null
 * for "not present", so storing a bare null would make a cached miss
 * indistinguishable from a cold key and defeat negative caching entirely.
 */
interface CachedPreview {
  previewUrl: string | null;
}

/**
 * Spotify track id is the stable identity — the same recording appears under
 * varying name/artist strings across playlists (feat. credits, remaster tags,
 * casing), which would fragment a string-keyed cache. Falls back to a
 * normalised query key so callers that don't send an id still get caching.
 */
function cacheKey(id: string, track: string, artist: string): string {
  if (id) return `preview:id:${id}`;
  // Normalise each part before joining, not the joined string: Spotify track
  // names carry stray leading/trailing whitespace, and trimming only the ends
  // of "track|artist" would leave " song |artist" as a distinct key from
  // "song|artist" — quietly fragmenting the cache for the same recording.
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return `preview:q:${normalize(track)}|${normalize(artist)}`;
}

async function readCache(key: string): Promise<CachedPreview | null> {
  try {
    const store = await getKvStore();
    return await store.get<CachedPreview>(key);
  } catch {
    // A cache outage must degrade to "slower", never to "broken" — fall
    // through and resolve from upstream as if the key were cold.
    return null;
  }
}

async function writeCache(key: string, previewUrl: string | null): Promise<void> {
  try {
    const store = await getKvStore();
    await store.set(
      key,
      { previewUrl } satisfies CachedPreview,
      previewUrl ? HIT_TTL_SECONDS : MISS_TTL_SECONDS
    );
  } catch {
    // Swallowed deliberately. An unhandled write failure would turn a request
    // that already has its answer into a 500 and stall the game mid-round.
  }
}

/** Searches iTunes then Deezer. Returns null when neither has a preview. */
async function resolveFromUpstream(track: string, artist: string): Promise<string | null> {
  // iTunes Search API — free, no auth, reliable 30s previews
  const itunesQueries = [
    `${track} ${artist}`.trim(),
    track,
  ];

  for (const q of itunesQueries) {
    try {
      const res = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=musicTrack&limit=10`,
        { headers: { "Accept": "application/json" } }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const results = data.results as Array<{ previewUrl?: string; trackName?: string; artistName?: string }> | undefined;
      // Prefer exact track name match, fall back to first with a preview
      const exact = results?.find(
        (r) => r.previewUrl && r.trackName?.toLowerCase() === track.toLowerCase()
      );
      const any = results?.find((r) => r.previewUrl);
      const match = exact ?? any;
      if (match?.previewUrl) {
        return match.previewUrl;
      }
    } catch {
      continue;
    }
  }

  // Deezer fallback
  const deezerQueries = [
    `track:"${track}" artist:"${artist}"`,
    `${track} ${artist}`.trim(),
    track,
  ];

  for (const q of deezerQueries) {
    try {
      const res = await fetch(
        `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=10`,
        { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const match = (data.data as Array<{ preview?: string }> | undefined)?.find((r) => r.preview);
      if (match?.preview) {
        return match.preview;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const track = searchParams.get("track") ?? "";
  const artist = searchParams.get("artist") ?? "";
  const id = searchParams.get("id") ?? "";

  if (!track) return NextResponse.json({ previewUrl: null });

  const limited = await enforceRateLimit(
    req,
    "preview",
    PREVIEW_LIMIT,
    PREVIEW_WINDOW_SECONDS,
    "rate_limited_preview"
  );
  if (limited) return limited;

  const key = cacheKey(id, track, artist);

  const cached = await readCache(key);
  if (cached) {
    return NextResponse.json({ previewUrl: cached.previewUrl });
  }

  const previewUrl = await resolveFromUpstream(track, artist);
  await writeCache(key, previewUrl);

  return NextResponse.json({ previewUrl });
}
