import { describe, it, expect } from "vitest";
import type { Track } from "@/types";
import {
  DEFAULT_PLAY_STYLE,
  ORDER_MIN_ROUND_SIZE,
  ORDER_MIN_YEAR,
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
  });
});
