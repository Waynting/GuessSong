/**
 * Mixed Playlist Mode group taste card (v2) — pure functions computing
 * awards from the pooled tracks + round history. Spec §7 lists four awards;
 * "most often mistaken for someone else" is dropped from this cut because
 * the host-judged scoring UI (v1.5) only records whether a source guess was
 * *correct*, never who was guessed instead when it was wrong — there's no
 * data to compute it from without adding a new host input step.
 */

import type { Track } from "@/types";
import type { RoundHistoryEntry } from "@/lib/round-history";

export interface SharedTrack {
  trackId: string;
  name: string;
  artists: string[];
  contributors: string[];
}

export interface ObscureAward {
  playerName: string;
  correctAttributions: number;
  totalTracks: number;
  /** 0-1, lower = more obscure (fewer correct source guesses). */
  rate: number;
}

export interface MainstreamAward {
  playerName: string;
  averagePopularity: number;
}

export interface TasteCard {
  /** Tracks that showed up in more than one player's playlist. */
  sharedTracks: SharedTrack[];
  /** Whose tracks were least often correctly attributed back to them. */
  mostObscure: ObscureAward | null;
  /** Whose contributed tracks have the highest average Spotify popularity. */
  mostMainstream: MainstreamAward | null;
}

export function findSharedTracks(tracks: Track[]): SharedTrack[] {
  return tracks
    .filter((t) => t.contributors && t.contributors.length > 1)
    .map((t) => ({
      trackId: t.id,
      name: t.name,
      artists: t.artists,
      contributors: t.contributors as string[],
    }));
}

export function computeMostObscure(history: RoundHistoryEntry[]): ObscureAward | null {
  const totals = new Map<string, number>();
  const correct = new Map<string, number>();

  for (const entry of history) {
    // A correct source guess only tells us *someone* named the right
    // playlist — the game doesn't record which contributor's name was
    // actually said. For a track shared by multiple contributors that's
    // ambiguous (crediting all of them would inflate everyone's rate), so
    // only single-contributor tracks count toward this stat.
    if (entry.contributors.length !== 1) continue;
    const [contributor] = entry.contributors;
    totals.set(contributor, (totals.get(contributor) ?? 0) + 1);
    if (entry.sourceWinner !== null) {
      correct.set(contributor, (correct.get(contributor) ?? 0) + 1);
    }
  }

  let best: ObscureAward | null = null;
  for (const [playerName, totalTracks] of totals) {
    const correctAttributions = correct.get(playerName) ?? 0;
    const rate = correctAttributions / totalTracks;
    // The tiebreak is load-bearing, not tidiness. A cross-culture room is the
    // case this award exists for and it is also the case where every rate is
    // 0 — nobody places anybody's music — so `rate < best.rate` never fires and
    // a plain scan hands the award to whichever name the Map happened to see
    // first, i.e. whoever submitted earliest. That reads as a finding and is an
    // accident of insertion order.
    //
    // More tracks wins, because twelve songs nobody could place is a stronger
    // claim than three. `totalTracks` is already the count of that
    // contributor's solo tracks that were actually played, so this needs no
    // extra data and no signature change.
    const better =
      !best || rate < best.rate || (rate === best.rate && totalTracks > best.totalTracks);
    if (better) {
      best = { playerName, correctAttributions, totalTracks, rate };
    }
  }
  return best;
}

export function computeMostMainstream(tracks: Track[]): MainstreamAward | null {
  const totals = new Map<string, { sum: number; count: number }>();

  for (const track of tracks) {
    if (typeof track.popularity !== "number" || !track.contributors) continue;
    for (const contributor of track.contributors) {
      const agg = totals.get(contributor) ?? { sum: 0, count: 0 };
      agg.sum += track.popularity;
      agg.count += 1;
      totals.set(contributor, agg);
    }
  }

  let best: MainstreamAward | null = null;
  for (const [playerName, { sum, count }] of totals) {
    const averagePopularity = sum / count;
    if (!best || averagePopularity > best.averagePopularity) {
      best = { playerName, averagePopularity };
    }
  }
  return best;
}

export function buildTasteCard(tracks: Track[], history: RoundHistoryEntry[]): TasteCard {
  return {
    sharedTracks: findSharedTracks(tracks),
    mostObscure: computeMostObscure(history),
    mostMainstream: computeMostMainstream(tracks),
  };
}
