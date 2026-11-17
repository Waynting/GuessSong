/**
 * "Your ears live in 1987" — the order game's Game Over result about the
 * player rather than an invitation to anyone.
 *
 * Why it exists: most games are one person alone, from Google, on the order
 * game, and the invite card ("send it to the group chat") read one real send
 * in 2,089 views. People alone share results about themselves. This is one.
 *
 * The year is the mean release year of the cards in the rounds the room got
 * right — a round called in full counts once per card, a round where only the
 * oldest song was named counts half, and a round nobody got contributes
 * nothing. So it is the era the player actually knows, not the era of the
 * playlist. No round scored is `null`, and the page renders nothing: a
 * sentence of zeroes is worse than no card.
 *
 * Pure, in `lib/` for the usual reason — the suite cannot import a page. The
 * rounds come from `closeRound` in `app/order/page.tsx`, the one place a
 * revealed round closes and already holds its verdict; this module never
 * grades. English only, like the page.
 */

import { releaseYear, type OrderVerdict } from "@/lib/order-game";
import type { Track } from "@/types";

/** One revealed round, as `closeRound` closed it. */
export interface MusicAgeRound {
  verdict: OrderVerdict;
  tracks: readonly Pick<Track, "releaseDate">[];
}

/** How much a round's cards count toward the year, by how it was scored. */
export const MUSIC_AGE_WEIGHTS: Record<OrderVerdict, number> = {
  exact: 1,
  partial: 0.5,
  none: 0,
};

export interface MusicAge {
  /** The weighted mean release year, rounded. */
  year: number;
  /** "the late '80s" — for copy. */
  decade: string;
}

/**
 * The weighted mean year over every dated card in every scored round, or
 * null when no round scored (or none of its cards carries a usable year).
 * `now` is for `releaseYear`'s upper bound, and for the tests.
 */
export function musicAge(rounds: readonly MusicAgeRound[], now: Date = new Date()): MusicAge | null {
  let sum = 0;
  let weight = 0;
  for (const round of rounds) {
    const w = MUSIC_AGE_WEIGHTS[round.verdict] ?? 0;
    if (w <= 0) continue;
    for (const track of round.tracks) {
      const year = releaseYear(track, now);
      if (year === null) continue;
      sum += year * w;
      weight += w;
    }
  }
  if (weight <= 0) return null;
  const year = Math.round(sum / weight);
  return { year, decade: decadeLabel(year) };
}

/**
 * "the early '80s" / "the mid '90s" / "the late 2010s". 0–3 is early, 4–6 is
 * mid, 7–9 is late. The 1900s take the apostrophe form everyone says; from
 * 2000 on the full decade, because "the early '00s" and "the late '10s" read
 * as typos.
 */
export function decadeLabel(year: number): string {
  const digit = ((year % 10) + 10) % 10;
  const part = digit <= 3 ? "early" : digit <= 6 ? "mid" : "late";
  const decade = year - digit;
  const name = decade < 2000 ? `'${String(decade % 100).padStart(2, "0")}s` : `${decade}s`;
  return `the ${part} ${name}`;
}

/** The card's words, for one player or a room of two or more. */
export interface MusicAgeCopy {
  headline: string;
  line: string;
  button: string;
  /** Sent with the link into a chat; the recipient has never heard of the site. */
  shareText: string;
}

export function musicAgeCopy(age: MusicAge, room: boolean): MusicAgeCopy {
  if (room) {
    return {
      headline: `This room's ears live in ${age.year}`,
      line: `Somewhere in ${age.decade}, going by the rounds you got right.`,
      button: "Share our music age",
      shareText: `Our ears live in ${age.year} (${age.decade}). What year are yours?`,
    };
  }
  return {
    headline: `Your ears live in ${age.year}`,
    line: `Somewhere in ${age.decade}, going by the rounds you got right.`,
    button: "Share my music age",
    shareText: `My ears live in ${age.year} (${age.decade}). What year are yours?`,
  };
}
