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
 * grades. English, plus Portuguese for a game started from the Portuguese
 * setup page (`musicAgeCopy`'s `locale`, from the payload — lib/order-copy.ts).
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
export function decadeLabel(year: number, locale: "en" | "pt" = "en"): string {
  const digit = ((year % 10) + 10) % 10;
  const decade = year - digit;
  if (locale === "pt") {
    // "o começo dos anos 80" / "o meio dos anos 90" / "o fim dos anos 2010":
    // two digits for the 1900s, as Brazilians say it; "anos 00" would read
    // as the 2000s, so 1900–1909 keeps its four.
    const part = digit <= 3 ? "o começo" : digit <= 6 ? "o meio" : "o fim";
    const name = decade < 2000 && decade > 1900 ? String(decade % 100).padStart(2, "0") : String(decade);
    return `${part} dos anos ${name}`;
  }
  const part = digit <= 3 ? "early" : digit <= 6 ? "mid" : "late";
  const name = decade < 2000 ? `'${String(decade % 100).padStart(2, "0")}s` : `${decade}s`;
  return `the ${part} ${name}`;
}

/** The card's words, for one player or a room of two or more. */
export interface MusicAgeCopy {
  headline: string;
  line: string;
  button: string;
  /** The button's flash once the link is on the clipboard. */
  copied: string;
  /** Sent with the link into a chat; the recipient has never heard of the site. */
  shareText: string;
}

/**
 * `locale` is the game payload's (`lib/order-copy.ts`). The Portuguese
 * decade is derived from the year here rather than read from `age.decade`,
 * which `musicAge` writes in English.
 */
export function musicAgeCopy(age: MusicAge, room: boolean, locale: "en" | "pt" = "en"): MusicAgeCopy {
  if (locale === "pt") {
    const decade = decadeLabel(age.year, "pt");
    // "em" + "o fim…" contracts to "no fim…".
    const inDecade = `n${decade}`;
    return room
      ? {
          headline: `Os ouvidos desta sala vivem em ${age.year}`,
          line: `Em algum lugar ${inDecade}, pelas rodadas que vocês acertaram.`,
          button: "Compartilhar nossa idade musical",
          copied: "Link copiado ✓",
          shareText: `Nossos ouvidos vivem em ${age.year} (${decade}). E os seus, vivem em que ano?`,
        }
      : {
          headline: `Seus ouvidos vivem em ${age.year}`,
          line: `Em algum lugar ${inDecade}, pelas rodadas que você acertou.`,
          button: "Compartilhar minha idade musical",
          copied: "Link copiado ✓",
          shareText: `Meus ouvidos vivem em ${age.year} (${decade}). E os seus, vivem em que ano?`,
        };
  }
  if (room) {
    return {
      headline: `This room's ears live in ${age.year}`,
      line: `Somewhere in ${age.decade}, going by the rounds you got right.`,
      button: "Share our music age",
      copied: "Link copied ✓",
      shareText: `Our ears live in ${age.year} (${age.decade}). What year are yours?`,
    };
  }
  return {
    headline: `Your ears live in ${age.year}`,
    line: `Somewhere in ${age.decade}, going by the rounds you got right.`,
    button: "Share my music age",
    copied: "Link copied ✓",
    shareText: `My ears live in ${age.year} (${age.decade}). What year are yours?`,
  };
}
