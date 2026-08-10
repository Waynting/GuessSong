/**
 * Mixed Playlist Mode pooling logic — dedupe multiple players' playlists into
 * one pool with provenance, then fair-sample per contributor.
 *
 * Pure functions, no browser/server APIs, so they're unit-testable and
 * reusable server-side (v1's /api/room/:code/pool route) without change.
 */

import type { Track } from "@/types";

export interface PlaylistContribution {
  playerName: string;
  tracks: Track[];
}

export interface PooledTrack extends Track {
  contributors: string[];
}

/**
 * A stable identity for one roster of contributor playlists.
 *
 * The single-playlist start remembers a doomed submission by its URL string;
 * mixed mode has no single URL, so it remembers the whole roster. Sorted, so
 * that dragging the same people into a different order is recognised as the
 * same question — reordering cannot change which playlists are unreadable.
 * Removing or fixing one contributor does change it, which is exactly when
 * asking again is worth a request.
 *
 * `JSON.stringify` rather than `join`, so a URL containing the delimiter
 * cannot make two different rosters collide into one key.
 */
export function mixedRosterKey(playlistUrls: string[]): string {
  return JSON.stringify([...playlistUrls].sort());
}

/**
 * Normalize a track's name + primary artist into a cross-platform dedupe
 * key. Strips remaster/live/feat. suffixes and punctuation/casing noise so
 * the same song contributed from different playlists (or platforms, once
 * non-Spotify sources exist) collapses to a single pooled track. This is a
 * best-effort fingerprint, not exact matching — occasional over/under-merge
 * is an accepted tradeoff for a "delight, not precision" feature.
 */
export function fingerprint(name: string, artists: string[]): string {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[([]feat\.?[^)\]]*[)\]]/g, "")
      .replace(/[-([].*?(remaster(ed)?|live|version|edit|mix|mono|stereo|deluxe)[^)\]]*[)\]]?/gi, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const primaryArtist = artists[0] ?? "";
  return `${normalize(name)}::${normalize(primaryArtist)}`;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Dedupe every contributor's tracks into one pool, merging `contributors`
 * on shared tracks, then sample up to `sampledPerPlayer` tracks per
 * contributor (a shared track counts against every one of its contributors'
 * quotas — a track is only included once none of its contributors have hit
 * their cap), and shuffle the final pool.
 */
export function poolContributions(
  contributions: PlaylistContribution[],
  sampledPerPlayer: number
): PooledTrack[] {
  const byFingerprint = new Map<string, PooledTrack>();

  for (const { playerName, tracks } of contributions) {
    for (const track of tracks) {
      const fp = fingerprint(track.name, track.artists);
      const existing = byFingerprint.get(fp);
      if (existing) {
        if (!existing.contributors.includes(playerName)) {
          existing.contributors.push(playerName);
        }
      } else {
        byFingerprint.set(fp, { ...track, contributors: [playerName] });
      }
    }
  }

  const shuffledPool = shuffle(Array.from(byFingerprint.values()));
  const quota = new Map<string, number>();
  const sampled: PooledTrack[] = [];

  for (const track of shuffledPool) {
    const hasRoom = track.contributors.every(
      (name) => (quota.get(name) ?? 0) < sampledPerPlayer
    );
    if (!hasRoom) continue;
    for (const name of track.contributors) {
      quota.set(name, (quota.get(name) ?? 0) + 1);
    }
    sampled.push(track);
  }

  return shuffle(sampled);
}
