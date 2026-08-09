#!/usr/bin/env node
/**
 * Curation script for built-in trial playlists.
 *
 * Two input modes:
 *   1. Default — uses the hardcoded CANDIDATE_PLAYLISTS below (name + artist
 *      per track).
 *   2. Spotify  — set `spotifyUrl` on a playlist entry and export
 *      SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET; the script fetches the
 *      playlist tracks from the Spotify API instead of the candidates list.
 *
 * Every candidate track is verified against the iTunes Search API (the same
 * lookup `/api/preview` performs at runtime), tracks without a working
 * 30s preview are dropped, and the first MAX_TRACKS verified tracks are
 * written to lib/builtin-playlists-data.json (rawJson stripped, preview URL
 * intentionally NOT baked in — runtime still resolves it lazily via
 * /api/preview, this script only guarantees the hit rate).
 *
 * Usage: node scripts/fetch-builtin-playlists.mjs
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUTPUT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "lib",
  "builtin-playlists-data.json"
);

const MIN_TRACKS = 12;
const MAX_TRACKS = 16;
const ITUNES_DELAY_MS = 400; // stay under iTunes Search API rate limits

/* ------------------------------------------------------------------ */
/* Curated candidates (18-20 widely known songs per theme)             */
/* ------------------------------------------------------------------ */

const CANDIDATE_PLAYLISTS = [
  {
    id: "mandarin-classics",
    name: "華語金曲",
    description: "90s & 2000s Mandopop classics everyone knows",
    coverEmoji: "🎤",
    // spotifyUrl: "https://open.spotify.com/playlist/...", // optional
    // `aliases` = romanized artist names iTunes may return for the US store.
    candidates: [
      { name: "七里香", artist: "周杰倫", aliases: ["Jay Chou"] },
      { name: "晴天", artist: "周杰倫", aliases: ["Jay Chou"] },
      { name: "安靜", artist: "周杰倫", aliases: ["Jay Chou"] },
      { name: "唯一", artist: "王力宏", aliases: ["Leehom Wang", "Wang Leehom"] },
      { name: "聽海", artist: "張惠妹", aliases: ["aMEI", "A-Mei", "Chang Hui-mei"] },
      { name: "記得", artist: "張惠妹", aliases: ["aMEI", "A-Mei", "Chang Hui-mei"] },
      { name: "遇見", artist: "孫燕姿", aliases: ["Stefanie Sun", "Sun Yan-Zi"] },
      { name: "天黑黑", artist: "孫燕姿", aliases: ["Stefanie Sun", "Sun Yan-Zi"] },
      { name: "倔強", artist: "五月天", aliases: ["Mayday"] },
      { name: "溫柔", artist: "五月天", aliases: ["Mayday"] },
      { name: "倒帶", artist: "蔡依林", aliases: ["Jolin Tsai"] },
      { name: "勇氣", artist: "梁靜茹", aliases: ["Fish Leong"] },
      { name: "寧夏", artist: "梁靜茹", aliases: ["Fish Leong"] },
      { name: "紅豆", artist: "王菲", aliases: ["Faye Wong"] },
      { name: "吻別", artist: "張學友", aliases: ["Jacky Cheung"] },
      { name: "後來", artist: "劉若英", aliases: ["Rene Liu", "René Liu"] },
      { name: "愛很簡單", artist: "陶喆", aliases: ["David Tao"] },
      { name: "Super Star", artist: "S.H.E", aliases: ["S.H.E"] },
      { name: "江南", artist: "林俊傑", aliases: ["JJ Lin"] },
      { name: "最熟悉的陌生人", artist: "蕭亞軒", aliases: ["Elva Hsiao"] },
    ],
  },
  {
    id: "western-classics",
    name: "Western Classics",
    description: "Timeless rock & pop anthems from the 70s-90s",
    coverEmoji: "🎸",
    candidates: [
      { name: "Bohemian Rhapsody", artist: "Queen" },
      { name: "Don't Stop Me Now", artist: "Queen" },
      { name: "Dancing Queen", artist: "ABBA" },
      { name: "Billie Jean", artist: "Michael Jackson" },
      { name: "Beat It", artist: "Michael Jackson" },
      { name: "Hey Jude", artist: "The Beatles" },
      { name: "Let It Be", artist: "The Beatles" },
      { name: "Hotel California", artist: "Eagles" },
      { name: "Take On Me", artist: "a-ha" },
      { name: "Livin' On A Prayer", artist: "Bon Jovi" },
      { name: "Don't Stop Believin'", artist: "Journey" },
      { name: "I Will Always Love You", artist: "Whitney Houston" },
      { name: "My Heart Will Go On", artist: "Céline Dion" },
      { name: "I Want It That Way", artist: "Backstreet Boys" },
      { name: "Wonderwall", artist: "Oasis" },
      { name: "Smells Like Teen Spirit", artist: "Nirvana" },
      { name: "Sweet Child O' Mine", artist: "Guns N' Roses" },
      { name: "Girls Just Want to Have Fun", artist: "Cyndi Lauper" },
      { name: "Africa", artist: "TOTO" },
      { name: "Every Breath You Take", artist: "The Police" },
    ],
  },
  {
    id: "2010s-pop",
    name: "2010s Pop Hits",
    description: "Chart-toppers from the streaming decade",
    coverEmoji: "🔥",
    candidates: [
      { name: "Rolling in the Deep", artist: "Adele" },
      { name: "Someone Like You", artist: "Adele" },
      { name: "Shape of You", artist: "Ed Sheeran" },
      { name: "Thinking Out Loud", artist: "Ed Sheeran" },
      { name: "Uptown Funk", artist: "Mark Ronson" },
      { name: "Just the Way You Are", artist: "Bruno Mars" },
      { name: "Shake It Off", artist: "Taylor Swift" },
      { name: "Blank Space", artist: "Taylor Swift" },
      { name: "Roar", artist: "Katy Perry" },
      { name: "Firework", artist: "Katy Perry" },
      { name: "Sugar", artist: "Maroon 5" },
      { name: "Happy", artist: "Pharrell Williams" },
      { name: "Counting Stars", artist: "OneRepublic" },
      { name: "Wake Me Up", artist: "Avicii" },
      { name: "Faded", artist: "Alan Walker" },
      { name: "Sorry", artist: "Justin Bieber" },
      { name: "Closer", artist: "The Chainsmokers" },
      { name: "Despacito", artist: "Luis Fonsi" },
      { name: "Bad Romance", artist: "Lady Gaga" },
      { name: "Radioactive", artist: "Imagine Dragons" },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* iTunes verification (mirrors the runtime /api/preview lookup)       */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function itunesSearch(term) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=musicTrack&limit=10`,
        { headers: { Accept: "application/json" } }
      );
      if (res.status === 403 || res.status === 429) {
        // rate limited — back off and retry
        await sleep(5000 * (attempt + 1));
        continue;
      }
      if (!res.ok) return null;
      return (await res.json()).results ?? null;
    } catch {
      await sleep(1000);
    }
  }
  return null;
}

const JUNK_VERSION =
  /\b(live|karaoke|cover|remix|tribute|instrumental|video album)\b/i;

/**
 * Verify a track has a usable 30s preview at runtime.
 *
 * Simulates the exact pick `/api/preview` makes at runtime (same queries,
 * exact-track-name-or-first-hit selection) and only accepts the candidate
 * when the preview users would actually hear is by the expected artist —
 * this catches covers and wrong-song matches (e.g. a different artist's
 * track ranking first). Returns the best metadata match (for album name /
 * artwork), or null when the candidate should be dropped.
 *
 * Since 1.2.0 this approximates rather than mirrors the runtime: pickCandidate
 * also ranks on Spotify's running time, and there is no Spotify duration on
 * this path because tracks are built from iTunes. The gate below is
 * deliberately stricter to compensate.
 */
async function verifyTrackWithItunes(name, artist, aliases = []) {
  const lcName = name.toLowerCase();
  const artistNames = [artist, ...aliases].map((a) => a.toLowerCase()).filter(Boolean);
  const artistMatches = (r) => {
    const a = (r.artistName ?? "").toLowerCase();
    return artistNames.some((c) => a.includes(c) || c.includes(a));
  };
  const isJunk = (r) =>
    JUNK_VERSION.test(r.trackName ?? "") || JUNK_VERSION.test(r.collectionName ?? "");
  // "Happy (From 'Despicable Me 2')" → "happy"
  const normName = (s) => (s ?? "").toLowerCase().replace(/\s*[([].*$/, "").trim();

  // Approximates /api/preview's query order. Not identical since 1.2.0: the
  // runtime drops the title-only follow-up when there is no artist, and gates
  // it on a verified credit when there is.
  const queries = [`${name} ${artist}`.trim(), name];

  for (const q of queries) {
    const results = await itunesSearch(q);
    const withPreview = (results ?? []).filter((r) => r.previewUrl);
    // Runtime only falls through to the next query when this one had no preview.
    if (!withPreview.length) continue;

    // A deliberately STRICTER stand-in for the runtime pick, not a simulation
    // of it. lib/preview-cache.ts's pickCandidate ranks on the credit, the
    // exact title AND Spotify's running time; there is no Spotify duration on
    // this path (tracks are built from iTunes), so the clock signal is not
    // available here. Erring strict is the right side to be wrong on: a track
    // dropped at bundle time costs one song in a trial playlist, where a bad
    // one ships to every player.
    const exact = withPreview.find((r) => r.trackName?.toLowerCase() === lcName);
    const runtimePick = exact ?? withPreview[0];

    // Quality gate: drop the candidate if the preview is a cover / wrong song
    // by another artist.
    if (!artistMatches(runtimePick)) return null;

    // Metadata: prefer a non-junk result by the right artist whose
    // normalized name matches (studio version artwork over live albums).
    const good = withPreview.filter((r) => artistMatches(r) && !isJunk(r));
    return good.find((r) => normName(r.trackName) === lcName) ?? good[0] ?? runtimePick;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Optional: fetch candidates from a Spotify playlist                  */
/* ------------------------------------------------------------------ */

async function getSpotifyToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET must be set for Spotify mode");
  }
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Spotify token failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function fetchSpotifyCandidates(spotifyUrl, token) {
  const match = spotifyUrl.match(/playlist[/:]([a-zA-Z0-9]+)/);
  if (!match) throw new Error(`Invalid Spotify playlist URL: ${spotifyUrl}`);
  const candidates = [];
  let url = `https://api.spotify.com/v1/playlists/${match[1]}/tracks?limit=50`;
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Spotify tracks fetch failed: ${res.status}`);
    const data = await res.json();
    for (const item of data.items) {
      if (item.track) {
        candidates.push({
          name: item.track.name,
          artist: item.track.artists?.[0]?.name ?? "",
        });
      }
    }
    url = data.next || null;
  }
  return candidates;
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const output = { generatedAt: new Date().toISOString(), verified: true, playlists: [] };
  let spotifyToken = null;

  for (const playlist of CANDIDATE_PLAYLISTS) {
    let candidates = playlist.candidates;
    if (playlist.spotifyUrl) {
      spotifyToken ??= await getSpotifyToken();
      candidates = await fetchSpotifyCandidates(playlist.spotifyUrl, spotifyToken);
    }

    console.log(`\n── ${playlist.name} (${candidates.length} candidates)`);
    const tracks = [];

    for (const candidate of candidates) {
      if (tracks.length >= MAX_TRACKS) break;
      const match = await verifyTrackWithItunes(
        candidate.name,
        candidate.artist,
        candidate.aliases
      );
      await sleep(ITUNES_DELAY_MS);

      if (!match) {
        console.log(`  ✗ ${candidate.name} — ${candidate.artist} (no preview, dropped)`);
        continue;
      }
      console.log(`  ✓ ${candidate.name} — ${candidate.artist}`);
      tracks.push({
        id: `itunes-${match.trackId}`,
        name: candidate.name,
        artists: [candidate.artist],
        durationMs: match.trackTimeMillis ?? 0,
        albumName: match.collectionName ?? undefined,
        albumImageUrl: match.artworkUrl100
          ? match.artworkUrl100.replace("100x100", "400x400")
          : undefined,
        // No previewUrl: clips are resolved at runtime via /api/preview, and
        // Track dropped the field in 1.2.0 — emitting it here would put all 48
        // permanently-null entries straight back into the bundled data.
        createdAt: new Date().toISOString(),
      });
    }

    if (tracks.length < MIN_TRACKS) {
      console.warn(
        `  ⚠ Only ${tracks.length}/${MIN_TRACKS} verified tracks for "${playlist.name}" — add or swap candidates.`
      );
    }

    output.playlists.push({
      id: playlist.id,
      name: playlist.name,
      description: playlist.description,
      coverEmoji: playlist.coverEmoji,
      tracks,
    });
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n");
  console.log(`\nWrote ${OUTPUT_PATH}`);
  for (const p of output.playlists) {
    console.log(`  ${p.name}: ${p.tracks.length} tracks`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
