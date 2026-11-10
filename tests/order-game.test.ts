import { describe, it, expect } from "vitest";
import type { Track } from "@/types";
import {
  DEFAULT_PLAY_STYLE,
  ORDER_MIN_ROUND_SIZE,
  ORDER_MIN_YEAR,
  ORDER_PREFERRED_YEAR_GAP,
  ORDER_ROUND_SIZE,
  ORDER_VERDICTS,
  PLAY_STYLES,
  buildOrderRounds,
  isOrderVerdict,
  isPlayStyle,
  noReleaseDates,
  orderRefusal,
  orderLeftoverLine,
  orderRoundCount,
  orderRoundsPlayed,
  orderSummary,
  orderVerdict,
  releaseYear,
  showDragCue,
  trueOrder,
  usableOrderTracks,
} from "@/lib/order-game";

let serial = 0;
function track(releaseDate: string | undefined, name = `Song ${++serial}`): Track {
  return {
    id: `t${serial}`,
    name,
    artists: ["Artist"],
    durationMs: 200_000,
    createdAt: "",
    ...(releaseDate !== undefined ? { releaseDate } : {}),
  };
}

const NOW = new Date("2026-10-09T00:00:00Z");

describe("releaseYear", () => {
  it("reads the year off every precision Spotify uses", () => {
    expect(releaseYear(track("1997"), NOW)).toBe(1997);
    expect(releaseYear(track("1997-05"), NOW)).toBe(1997);
    expect(releaseYear(track("1997-05-21"), NOW)).toBe(1997);
  });

  it("refuses what is not a date, including Spotify's 0000 for unknown", () => {
    for (const bad of ["0000", "0000-01-01", "", "May 1997", "97", "19975", "abcd", "1899"]) {
      expect(releaseYear(track(bad), NOW), bad).toBeNull();
    }
    expect(releaseYear(track(undefined), NOW)).toBeNull();
    expect(releaseYear({ releaseDate: 1997 as unknown as string }, NOW)).toBeNull();
  });

  it("allows next year's pre-release and nothing later", () => {
    expect(releaseYear(track("2027"), NOW)).toBe(2027);
    expect(releaseYear(track("2028"), NOW)).toBeNull();
    expect(releaseYear(track(String(ORDER_MIN_YEAR)), NOW)).toBe(ORDER_MIN_YEAR);
  });
});

describe("usableOrderTracks", () => {
  it("keeps the dated tracks in their order and drops the rest", () => {
    const a = track("2001");
    const b = track(undefined);
    const c = track("1988-02");
    const d = track("0000");
    expect(usableOrderTracks([a, b, c, d])).toEqual([a, c]);
  });
});

describe("compilations and a cache with no dates yet", () => {
  it("never deals a compilation track, whose date is the compilation's", () => {
    const comp = { ...track("2011"), albumCompilation: true as const };
    const real = track("1997");
    expect(usableOrderTracks([comp, real])).toEqual([real]);
  });

  it("tells a dateless list (an old cache entry) apart from one with too few years", () => {
    expect(noReleaseDates([track(undefined), track(undefined)])).toBe(true);
    expect(noReleaseDates([track(undefined), track("0000")])).toBe(false);
    // Most dateless is a stale cache, even with one fresh contributor.
    expect(noReleaseDates([track(undefined), track(undefined), track("1999")])).toBe(true);
    expect(noReleaseDates([])).toBe(false);
    expect(orderRefusal([track(undefined), track(undefined), track(undefined)])).toBe("order_dates_pending");
    expect(orderRefusal([track("2023"), track("2023"), track(undefined)])).toBe("order_too_few_dated");
    expect(orderRefusal([track("2023"), track("1999")])).toBeNull();
    // Compilations only: dated, but nothing dealable — a real refusal, not the cache.
    expect(
      orderRefusal([
        { ...track("2001"), albumCompilation: true as const },
        { ...track("2002"), albumCompilation: true as const },
      ])
    ).toBe("order_too_few_dated");
  });
});

describe("buildOrderRounds", () => {
  it("deals rounds of distinct years, in the order given, and a short last round", () => {
    const tracks = [
      track("2001"),
      track("1999"),
      track("2010"),
      track("2001"), // deferred: 2001 is already in round one
      track("1975"),
      track("1999"),
    ];
    const { rounds, leftover } = buildOrderRounds(tracks);
    expect(rounds).toHaveLength(2);
    expect(rounds[0].tracks).toEqual([tracks[0], tracks[1], tracks[2], tracks[4]]);
    expect(rounds[1].tracks).toEqual([tracks[3], tracks[5]]);
    expect(leftover).toBe(0);
    for (const round of rounds) {
      const years = round.tracks.map((t) => releaseYear(t));
      expect(new Set(years).size).toBe(years.length);
      expect(round.tracks.length).toBeLessThanOrEqual(ORDER_ROUND_SIZE);
      expect(round.tracks.length).toBeGreaterThanOrEqual(ORDER_MIN_ROUND_SIZE);
    }
  });

  it("counts the undated and the same-year remainder as left out, never pads a round", () => {
    const tracks = [track("2020"), track(undefined), track("2020"), track("2020"), track("2021")];
    const { rounds, leftover } = buildOrderRounds(tracks);
    // One round of 2020 + 2021; the two other 2020s cannot be dealt with each other.
    expect(rounds).toHaveLength(1);
    expect(rounds[0].tracks.map((t) => releaseYear(t))).toEqual([2020, 2021]);
    expect(leftover).toBe(3);
    expect(rounds.flatMap((r) => r.tracks).length + leftover).toBe(tracks.length);
  });

  it("yields no round for a single-year playlist, and says every song was left out", () => {
    const tracks = [track("2023"), track("2023"), track("2023")];
    expect(buildOrderRounds(tracks)).toEqual({ rounds: [], leftover: 3 });
    expect(buildOrderRounds([])).toEqual({ rounds: [], leftover: 0 });
    expect(buildOrderRounds([track("2023")])).toEqual({ rounds: [], leftover: 1 });
  });

  it("is deterministic over the same list, so a reload deals the same game", () => {
    const tracks = Array.from({ length: 20 }, (_, i) => track(String(1990 + (i % 7))));
    const a = buildOrderRounds(tracks);
    const b = buildOrderRounds(tracks);
    expect(a).toEqual(b);
    expect(a.rounds.flatMap((r) => r.tracks).length + a.leftover).toBe(20);
  });

  it("fills twenty songs across seven years into five full rounds", () => {
    const tracks = Array.from({ length: 20 }, (_, i) => track(String(1990 + (i % 7))));
    const { rounds, leftover } = buildOrderRounds(tracks);
    expect(rounds.map((r) => r.tracks.length)).toEqual([4, 4, 4, 4, 4]);
    expect(leftover).toBe(0);
  });

  it("puts the short round last when the years run thin", () => {
    // Four years, ten songs: three full rounds would need twelve.
    const tracks = [
      ...["1990", "1991", "1992", "1993"].map((y) => track(y)),
      ...["1990", "1991", "1992", "1993"].map((y) => track(y)),
      track("1990"),
      track("1991"),
    ];
    const { rounds, leftover } = buildOrderRounds(tracks);
    expect(rounds.map((r) => r.tracks.length)).toEqual([4, 4, 2]);
    expect(leftover).toBe(0);
  });
});

describe("trueOrder", () => {
  it("sorts a round oldest first without touching the round", () => {
    const round = { tracks: [track("2010"), track("1975"), track("1999")] };
    const sorted = trueOrder(round);
    expect(sorted.map((t) => releaseYear(t))).toEqual([1975, 1999, 2010]);
    expect(round.tracks.map((t) => releaseYear(t))).toEqual([2010, 1975, 1999]);
  });
});

describe("the verdict and the rounds played", () => {
  it("buckets the host's two awards into three verdicts", () => {
    expect(orderVerdict({ exact: true, oldest: true })).toBe("exact");
    expect(orderVerdict({ exact: true, oldest: false })).toBe("exact");
    expect(orderVerdict({ exact: false, oldest: true })).toBe("partial");
    expect(orderVerdict({ exact: false, oldest: false })).toBe("none");
    for (const v of ORDER_VERDICTS) expect(isOrderVerdict(v)).toBe(true);
    for (const bad of ["EXACT", "", "half", 1, null, undefined]) expect(isOrderVerdict(bad)).toBe(false);
  });

  it("counts a round once it is revealed, like the guess game counts a clip", () => {
    expect(orderRoundsPlayed(0, "showing")).toBe(0);
    expect(orderRoundsPlayed(0, "revealed")).toBe(1);
    expect(orderRoundsPlayed(4, "revealed")).toBe(5);
    expect(orderRoundsPlayed(4, "showing")).toBe(4);
  });
});

describe("the setup page's words", () => {
  it("knows the two play styles and falls back to guessing", () => {
    expect(PLAY_STYLES).toEqual(["guess", "order"]);
    expect(DEFAULT_PLAY_STYLE).toBe("guess");
    for (const style of PLAY_STYLES) expect(isPlayStyle(style)).toBe(true);
    for (const bad of ["Order", "", "timeline", 1, null, {}]) expect(isPlayStyle(bad)).toBe(false);
  });

  it("turns a song count into rounds", () => {
    expect(orderRoundCount(20)).toBe(5);
    expect(orderRoundCount(10)).toBe(2);
    expect(orderRoundCount(3)).toBe(0);
    expect(orderSummary(20)).toBe("20 songs (5 rounds of 4)");
    expect(orderSummary(4)).toBe("4 songs (1 round of 4)");
    expect(orderSummary("all")).toBe("All songs, 4 a round");
  });

  it("says how many songs were left out, and nothing for none", () => {
    expect(orderLeftoverLine(0)).toBeNull();
    expect(orderLeftoverLine(-1)).toBeNull();
    expect(orderLeftoverLine(1)).toMatch(/^1 song left out/);
    expect(orderLeftoverLine(3)).toMatch(/^3 songs left out/);
    // "Too close in year", since the deal keeps a gap: the same year is the
    // special case, and a card a year off every other card is left out too.
    expect(orderLeftoverLine(3)).toMatch(/too close in year to every other card$/);
  });
});

describe("the deal prefers a year gap (2026-11-10)", () => {
  // 41.1% of revealed rounds scored nobody and 70% of the rounds left as
  // dealt did: 2019 against 2021 against 2022 is not a question. The deal
  // ladders from ORDER_PREFERRED_YEAR_GAP down to distinct years and takes
  // the widest gap whose whole deal gives nothing up.
  const years = (round: { tracks: Track[] }) => round.tracks.map((t) => releaseYear(t) as number);
  const pairwiseGap = (round: { tracks: Track[] }) => {
    const ys = years(round);
    let min = Infinity;
    for (let i = 0; i < ys.length; i++)
      for (let j = i + 1; j < ys.length; j++) min = Math.min(min, Math.abs(ys[i] - ys[j]));
    return min;
  };
  const measure = (deal: { rounds: { tracks: Track[] }[]; leftover: number }) => ({
    rounds: deal.rounds.length,
    full: deal.rounds.filter((r) => r.tracks.length === ORDER_ROUND_SIZE).length,
    cards: deal.rounds.reduce((n, r) => n + r.tracks.length, 0),
    leftover: deal.leftover,
  });

  it("ladders from the constant, which is three, and the default deal is the laddered one", () => {
    expect(ORDER_PREFERRED_YEAR_GAP).toBe(3);
    const tracks = [2000, 2001, 2010, 2020, 2002, 2011, 2021, 2003].map((y) => track(String(y)));
    expect(buildOrderRounds(tracks)).toEqual(buildOrderRounds(tracks, ORDER_ROUND_SIZE, ORDER_PREFERRED_YEAR_GAP));
    // A knob, not decoration: the gap-1 deal of the same list is a different game.
    expect(buildOrderRounds(tracks)).not.toEqual(buildOrderRounds(tracks, ORDER_ROUND_SIZE, 1));
    expect(buildOrderRounds(tracks, ORDER_ROUND_SIZE, 1).rounds[0].tracks.map((t) => releaseYear(t))).toEqual([
      2000, 2001, 2010, 2020,
    ]);
  });

  it("deals a wide list with no two cards closer than the gap, and loses nothing to it", () => {
    // The shape of "Hits from every decade": 375 songs over 66 years.
    const tracks = Array.from({ length: 375 }, (_, i) => track(String(1961 + ((i * 37) % 66))));
    const deal = buildOrderRounds(tracks);
    const plain = buildOrderRounds(tracks, ORDER_ROUND_SIZE, 1);
    for (const round of deal.rounds) expect(pairwiseGap(round)).toBeGreaterThanOrEqual(ORDER_PREFERRED_YEAR_GAP);
    expect(measure(deal).rounds).toBeGreaterThanOrEqual(measure(plain).rounds);
    expect(measure(deal).full).toBeGreaterThanOrEqual(measure(plain).full);
    expect(measure(deal).cards).toBe(375);
    expect(deal.leftover).toBe(0);
  });

  it("takes the widest gap whose whole deal gives nothing up, not the widest that fills round one", () => {
    // Gap 3 deals round one as 2000 · 2010 · 2020 · 2003 and then strands a
    // card (2001, 2002, 2011, 2021 cannot all sit three apart). Gap 2 deals
    // both rounds full. A per-round ladder would have taken gap 3 for the
    // first round and a different game would follow; the whole-deal ladder
    // takes gap 2 for both — design review F15.
    const tracks = [2000, 2001, 2010, 2020, 2002, 2011, 2021, 2003].map((y) => track(String(y)));
    const { rounds, leftover } = buildOrderRounds(tracks);
    expect(rounds.map(years)).toEqual([
      [2000, 2010, 2020, 2002],
      [2001, 2011, 2021, 2003],
    ]);
    expect(leftover).toBe(0);
    expect(rounds[0] && years(rounds[0])).not.toEqual([2000, 2010, 2020, 2003]);
    for (const round of rounds) expect(pairwiseGap(round)).toBeGreaterThanOrEqual(2);
  });

  it("falls back to distinct years on a list of consecutive years, and deals exactly as before", () => {
    // Seven consecutive years: at gap 3 the rounds come out three cards wide
    // (1990 · 1993 · 1996) — more rounds, fewer full ones. ORDER_ROUND_SIZE
    // is a decision, so the full-round count is in the comparison and the
    // ladder falls through to the deal of 2026-10.
    const seven = Array.from({ length: 20 }, (_, i) => track(String(1990 + (i % 7))));
    expect(buildOrderRounds(seven)).toEqual(buildOrderRounds(seven, ORDER_ROUND_SIZE, 1));
    expect(buildOrderRounds(seven).rounds.map((r) => r.tracks.length)).toEqual([4, 4, 4, 4, 4]);
    expect(years(buildOrderRounds(seven).rounds[0])).toEqual([1990, 1991, 1992, 1993]);
    const four = [
      ...["1990", "1991", "1992", "1993"].map((y) => track(y)),
      ...["1990", "1991", "1992", "1993"].map((y) => track(y)),
      track("1990"),
      track("1991"),
    ];
    expect(buildOrderRounds(four)).toEqual(buildOrderRounds(four, ORDER_ROUND_SIZE, 1));
    expect(buildOrderRounds(four).rounds.map((r) => r.tracks.length)).toEqual([4, 4, 2]);
  });

  it("settles for gap 2 on a 17-year playlist of 50 songs — the written expectation for the A2a read", () => {
    // The shape of "Party Hits 2010–2026", the starter most order games were
    // dealt from. Gap 3 strands cards here, gap 2 does not: round one is
    // 2010 · 2012 · 2014 · 2016, not 2010 · 2013 · 2016 · 2019. A nobody
    // share that barely moves on such lists is the gap settling at 2, not
    // the rule having no effect.
    const tracks = Array.from({ length: 50 }, (_, i) => track(String(2010 + (i % 17))));
    const deal = buildOrderRounds(tracks);
    expect(years(deal.rounds[0])).toEqual([2010, 2012, 2014, 2016]);
    expect(deal.rounds.map((r) => r.tracks.length)).toEqual([4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2]);
    expect(deal.leftover).toBe(0);
    for (const round of deal.rounds) expect(pairwiseGap(round)).toBeGreaterThanOrEqual(2);
  });

  it("never deals fewer rounds, fewer full rounds or fewer cards than distinct years would, over shuffled lists", () => {
    // A seeded generator, so a failure here is a fixture and not a flake.
    let seed = 20261110;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let n = 0; n < 300; n++) {
      const count = 5 + Math.floor(rand() * 56);
      const span = 2 + Math.floor(rand() * 65);
      const tracks: Track[] = [];
      for (let i = 0; i < count; i++) {
        const roll = rand();
        if (roll < 0.05) tracks.push(track(undefined));
        else if (roll < 0.1) tracks.push({ ...track(String(1960 + Math.floor(rand() * span))), albumCompilation: true });
        else tracks.push(track(String(1960 + Math.floor(rand() * span))));
      }
      const deal = buildOrderRounds(tracks);
      const plain = buildOrderRounds(tracks, ORDER_ROUND_SIZE, 1);
      const d = measure(deal);
      const p = measure(plain);
      const label = `list ${n}: ${count} songs over ${span} years`;
      expect(d.rounds, label).toBeGreaterThanOrEqual(p.rounds);
      expect(d.full, label).toBeGreaterThanOrEqual(p.full);
      expect(d.cards, label).toBeGreaterThanOrEqual(p.cards);
      expect(d.leftover, label).toBeLessThanOrEqual(p.leftover);
      expect(d.cards + d.leftover, label).toBe(tracks.length);
      for (const round of deal.rounds) {
        expect(round.tracks.length, label).toBeLessThanOrEqual(ORDER_ROUND_SIZE);
        expect(round.tracks.length, label).toBeGreaterThanOrEqual(ORDER_MIN_ROUND_SIZE);
        expect(pairwiseGap(round), label).toBeGreaterThanOrEqual(1);
      }
      expect(buildOrderRounds(tracks), label).toEqual(deal);
    }
  });

  it("leaves the refusal rule where it was: a list that dealt before still deals", () => {
    expect(orderRefusal([track("2023"), track("2023"), track("2023")])).toBe("order_too_few_dated");
    expect(orderRefusal([track("2023"), track("2024")])).toBeNull();
    expect(orderRefusal([track("2020"), track("2021"), track("2022"), track("2023")])).toBeNull();
  });
});

describe("the drag: an arrangement, and how it reads at the reveal", async () => {
  const { moveCard, dropSlot, readArrangement } = await import("@/lib/order-game");
  const card = (id: string, year: string) => ({ id, releaseDate: year });
  // Dealt C, A, D, B; the truth is A(1970) B(1980) C(1990) D(2000).
  const round = { tracks: [card("C", "1990"), card("A", "1970"), card("D", "2000"), card("B", "1980")] };

  it("moves a card and shifts the rest, without touching the input", () => {
    const ids = ["C", "A", "D", "B"];
    expect(moveCard(ids, 1, 0)).toEqual(["A", "C", "D", "B"]);
    expect(moveCard(ids, 0, 3)).toEqual(["A", "D", "B", "C"]);
    expect(moveCard(ids, 2, 2)).toEqual(ids);
    expect(moveCard(ids, 9, 0)).toEqual(ids);
    expect(moveCard(ids, 3, -5)).toEqual(["B", "C", "A", "D"]);
    expect(ids).toEqual(["C", "A", "D", "B"]);
  });

  it("drops onto the nearest slot", () => {
    const centres = [50, 130, 210, 290];
    expect(dropSlot(0, centres)).toBe(0);
    expect(dropSlot(95, centres)).toBe(1);
    expect(dropSlot(171, centres)).toBe(2);
    expect(dropSlot(999, centres)).toBe(3);
  });

  it("marks the whole order, the oldest card, and how many sit in place", () => {
    expect(readArrangement(["A", "B", "C", "D"], round)).toEqual({ inPlace: 4, exact: true, oldest: true });
    expect(readArrangement(["A", "C", "B", "D"], round)).toEqual({ inPlace: 2, exact: false, oldest: true });
    expect(readArrangement(["C", "A", "D", "B"], round)).toEqual({ inPlace: 0, exact: false, oldest: false });
  });
});

describe("showDragCue", () => {
  it("runs on round zero, before anything moved, on the screen that arranges — and nowhere else", () => {
    expect(showDragCue({ round: 0, moved: false, phones: false })).toBe(true);
    expect(showDragCue({ round: 0, moved: true, phones: false })).toBe(false);
    expect(showDragCue({ round: 0, moved: false, phones: true })).toBe(false);
    expect(showDragCue({ round: 1, moved: false, phones: false })).toBe(false);
  });
});

describe("hostArranged", () => {
  // Value: protects=the one predicate behind order_arranged and order_bounce — an
  //   arrangement counts only for its own round and only once a card moved;
  //   fails_when=the round check or the moved check is dropped, so a stale or dealt
  //   arrangement reads as the host's drag; why_new=the page spelled it inline, in regex
  //   reach only; seam=none; no_claim=the page passes the right round (its source tests).
  it("is true only for an arrangement of that round that was moved", async () => {
    const { hostArranged } = await import("@/lib/order-game");
    expect(hostArranged({ round: 2, ids: ["a", "b"], moved: true }, 2)).toBe(true);
    expect(hostArranged({ round: 2, ids: ["a", "b"], moved: false }, 2)).toBe(false);
    expect(hostArranged({ round: 1, ids: ["a", "b"], moved: true }, 2)).toBe(false);
    expect(hostArranged(null, 0)).toBe(false);
  });
});
