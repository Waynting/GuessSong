/**
 * "Put them in order", one phone each — the rules the host's page applies
 * when the order game has a buzzer room.
 *
 * The shared-screen game (`app/order/page.tsx` without a room) has one
 * arrangement on one screen and the host judging who called it. With a room,
 * every player arranges the same cards on their own phone and locks in, and
 * the host's page grades each lock at the reveal. The room (the Durable
 * Object in `worker/`) stores and relays; it never sees a year, so it cannot
 * grade, and the grading is here, in `lib/`, where the suite reaches it.
 *
 * Three rules, each the shape it is for a reason:
 *
 * - **A card carries no year, no date and no album** (`orderCardsFor`). The
 *   title is the cleaned one the host's screen shows, for the same reason:
 *   "Karma Police - Remastered 2011" names a year on a face-down card.
 * - **Every player who earned it gets it.** The shared screen's awards are
 *   one of each per round because only the room knows whose order it was;
 *   here every answer is its own, so the full order is worth
 *   `ORDER_EXACT_POINTS` to everyone who called it, and the oldest card alone
 *   `ORDER_OLDEST_POINTS` to everyone else who had it on top.
 * - **A seat that never locked in scores nothing, and is counted as such** —
 *   `locked: false` on its result, and outside `order_phone_verdict:*`, which
 *   grades answers, not absences. The host's own seat has no Lock in: the
 *   arrangement on the host's screen is the host's answer once a card has
 *   been moved there.
 */

import type { Track } from "@/types";
import type {
  OrderCard,
  OrderPhoneResult,
  OrderPhoneVerdict,
  OrderReveal,
  PlayerSummary,
} from "@/lib/buzzer-protocol";
import {
  ORDER_CARD_ART_MAX,
  ORDER_CARD_TEXT_MAX,
} from "@/lib/buzzer-protocol";
import {
  ORDER_EXACT_POINTS,
  ORDER_OLDEST_POINTS,
  ORDER_PHONE_VERDICTS,
  readArrangement,
  releaseYear,
  trueOrder,
  type OrderPhoneCoverage,
  type OrderRound,
  type OrderVerdict,
} from "@/lib/order-game";
import { displayTitle } from "@/lib/quiz";

/** The round's cards as the phones get them, in the order they were dealt. */
export function orderCardsFor(
  round: OrderRound<Pick<Track, "id" | "name" | "artists" | "albumImageUrl">>
): OrderCard[] {
  return round.tracks.map((t) => {
    const art = typeof t.albumImageUrl === "string" ? t.albumImageUrl : "";
    return {
      id: t.id,
      title: displayTitle(t.name).slice(0, ORDER_CARD_TEXT_MAX),
      artist: t.artists.join(", ").slice(0, ORDER_CARD_TEXT_MAX),
      // The room drops anything else; dropping it here too keeps the host's
      // own comparison (`sameDeal`) from reading the room's copy as a new deal.
      art: /^https:\/\//i.test(art) && art.length <= ORDER_CARD_ART_MAX ? art : "",
    };
  });
}

/**
 * True when the room already holds this deal, so the host's page has nothing
 * to send. Compared card by card, because a re-deal wipes every lock and the
 * page asks this on every reconnect.
 */
export function sameDeal(held: readonly OrderCard[] | undefined, cards: readonly OrderCard[]): boolean {
  if (!held || held.length !== cards.length) return false;
  return held.every(
    (c, i) =>
      c.id === cards[i].id &&
      c.title === cards[i].title &&
      c.artist === cards[i].artist &&
      c.art === cards[i].art
  );
}

/** True when `ids` is the round's cards, each once. Anything else is no answer. */
function isArrangement(ids: readonly string[], round: OrderRound<Pick<Track, "id">>): boolean {
  if (ids.length !== round.tracks.length) return false;
  const want = new Set(round.tracks.map((t) => t.id));
  return new Set(ids).size === ids.length && ids.every((id) => want.has(id));
}

/** One arrangement's grade, or `none` for no arrangement at all. */
export function gradeArrangement(
  ids: readonly string[] | null | undefined,
  round: OrderRound<Pick<Track, "id" | "releaseDate">>
): { verdict: OrderPhoneVerdict; points: number } {
  if (!ids || !isArrangement(ids, round)) return { verdict: "none", points: 0 };
  const result = readArrangement(ids, round);
  if (result.exact) return { verdict: "exact", points: ORDER_EXACT_POINTS };
  if (result.oldest) return { verdict: "oldest", points: ORDER_OLDEST_POINTS };
  return { verdict: "none", points: 0 };
}

/**
 * The reveal the host's page sends the room: the true order, every card's
 * year, and a result for every seat in `seats`. A seat with no arrangement
 * is `locked: false`, verdict `none`.
 */
export function orderRevealFor(
  round: OrderRound<Pick<Track, "id" | "releaseDate">>,
  seats: readonly string[],
  arrangements: Readonly<Record<string, readonly string[]>>
): OrderReveal {
  const order = trueOrder(round).map((t) => t.id);
  const years: Record<string, number> = {};
  for (const t of round.tracks) years[t.id] = releaseYear(t) ?? 0;
  const results: Record<string, OrderPhoneResult> = {};
  for (const seat of seats) {
    const ids = Object.hasOwn(arrangements, seat) ? arrangements[seat] : null;
    results[seat] = { ...gradeArrangement(ids, round), locked: ids !== null };
  }
  return { order, years, results };
}

/**
 * The seats that count as phones in play for "N of M locked in" and for
 * `order_phone:*`: every seat but the host's that is on a socket now or has
 * locked in. A phone that has gone away without answering is not a phone
 * that failed to find the button; one that answered and then locked its
 * screen still answered.
 */
export function phonesInPlay(
  players: readonly PlayerSummary[],
  locked: readonly string[],
  hostPlayerId: string
): PlayerSummary[] {
  const answered = new Set(locked);
  return players.filter((p) => p.playerId !== hostPlayerId && (p.connected || answered.has(p.playerId)));
}

/** `all`, `some` or `none` of `phones` locked in, or null when there were no phones. */
export function phoneCoverage(
  phones: readonly string[],
  locked: readonly string[]
): OrderPhoneCoverage | null {
  if (phones.length === 0) return null;
  const answered = new Set(locked);
  const n = phones.filter((id) => answered.has(id)).length;
  return n === phones.length ? "all" : n === 0 ? "none" : "some";
}

/** How the locked answers came out, counted. Seats that never locked are not in it. */
export function phoneVerdictCounts(reveal: OrderReveal): Record<OrderPhoneVerdict, number> {
  const counts = Object.fromEntries(ORDER_PHONE_VERDICTS.map((v) => [v, 0])) as Record<
    OrderPhoneVerdict,
    number
  >;
  for (const result of Object.values(reveal.results)) {
    if (result.locked) counts[result.verdict] += 1;
  }
  return counts;
}

/**
 * The round as `order_round:<verdict>` reads it — the best answer in the
 * room. Kept so that counter goes on summing to rounds played whichever way
 * the round was played; whether that answer came from a phone is
 * `order_phone:*`'s to say.
 */
export function roomVerdict(reveal: OrderReveal): OrderVerdict {
  const results = Object.values(reveal.results);
  if (results.some((r) => r.verdict === "exact")) return "exact";
  return results.some((r) => r.verdict === "oldest") ? "partial" : "none";
}
