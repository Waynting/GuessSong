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
 * Dedupe every contributor's tracks into one pool, then fill the game up to
 * `contributors × sampledPerPlayer` tracks and shuffle it.
 *
 * The first pass is the fair one, and is unchanged: tracks are taken in
 * shuffled order and one is only included while *every* contributor of it is
 * still under `sampledPerPlayer`, so a song two people both added spends a
 * slot from each of them.
 *
 * **That pass on its own silently shrank the game, which is what the backfill
 * below is for.** Charging a shared song to both quotas means the more taste
 * two people have in common, the fewer songs they get — measured over 3,000
 * pools of two 40-track playlists, 50% overlap returned 12.5 tracks where the
 * host had asked for 16, and identical playlists returned 8. Worse, the half
 * that survives is the shared half, so each player's *own* songs fall faster
 * than the total does: 8 exclusive tracks each at no overlap, 4.5 at 50%.
 * Nothing on the setup screen hints at any of this, so the host reads a short,
 * samey game as the mix not really mixing.
 *
 * So `sampledPerPlayer` is a starting point rather than a ceiling: once the
 * fair pass is done the same pass repeats with the cap raised one notch at a
 * time, until the target is met or the pool runs dry. Raising it uniformly is
 * what keeps the result even — everyone must reach `cap` before anyone may
 * pass it — so a contributor only ends up above `sampledPerPlayer` when
 * somebody else cannot get there at all, having either run out of tracks or
 * having nothing left that isn't shared with someone already full.
 *
 * Two properties not to break:
 * - The pool never exceeds the number of distinct songs available. A full-length
 *   game that repeats a song is worse than an honest short one.
 * - Nobody ends up below what the fair pass already gave them. The backfill only
 *   ever adds.
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

  // Distinct names rather than `contributions.length`: `quota` is keyed by
  // name, so two entries submitted under one name share a quota and must not
  // also buy a second player's worth of songs.
  const contributorCount = new Set(contributions.map((c) => c.playerName)).size;
  const target = contributorCount * sampledPerPlayer;

  const quota = new Map<string, number>();
  const sampled: PooledTrack[] = [];
  let remaining = shuffle(Array.from(byFingerprint.values()));

  // `cap` starts at the quota the host chose — that first round is exactly the
  // old fair pass — and only rises while the game is still short of `target`
  // and there is something left to add. It terminates: a round that admits
  // nothing leaves `remaining` untouched and raises `cap`, and no contributor's
  // count can exceed `sampled.length`, so a high enough `cap` admits every
  // remaining track.
  for (
    let cap = sampledPerPlayer;
    remaining.length > 0 && sampled.length < target;
    cap++
  ) {
    const deferred: PooledTrack[] = [];
    for (const track of remaining) {
      const hasRoom =
        sampled.length < target &&
        track.contributors.every((name) => (quota.get(name) ?? 0) < cap);
      if (!hasRoom) {
        deferred.push(track);
        continue;
      }
      for (const name of track.contributors) {
        quota.set(name, (quota.get(name) ?? 0) + 1);
      }
      sampled.push(track);
    }
    remaining = deferred;
  }

  // Still shuffled at the end: `sampled` is grouped by the round that admitted
  // each track, so the backfilled ones would otherwise all land together at the
  // back of the game.
  return shuffle(sampled);
}
