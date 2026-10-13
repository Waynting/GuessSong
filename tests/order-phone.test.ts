// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Track } from "@/types";
import type { PlayerSummary } from "@/lib/buzzer-protocol";
import { ORDER_EXACT_POINTS, ORDER_OLDEST_POINTS, type OrderRound } from "@/lib/order-game";
import {
  gradeArrangement,
  orderCardsFor,
  orderRevealFor,
  phoneCoverage,
  phoneVerdictCounts,
  phonesInPlay,
  roomVerdict,
  sameDeal,
} from "@/lib/order-phone";

function track(id: string, releaseDate: string, extra: Partial<Track> = {}): Track {
  return {
    id,
    name: `Song ${id}`,
    artists: ["Artist"],
    durationMs: 200_000,
    createdAt: "",
    releaseDate,
    releaseDatePrecision: "day",
    albumName: `Album ${releaseDate.slice(0, 4)}`,
    albumImageUrl: `https://i.scdn.co/image/${id}`,
    ...extra,
  };
}

// Dealt b, d, a, c; oldest first it is a (1971), b (1985), c (1999), d (2012).
const ROUND: OrderRound = {
  tracks: [track("b", "1985-01-01"), track("d", "2012-05"), track("a", "1971"), track("c", "1999-09-09")],
};

const seat = (playerId: string, name: string, connected = true): PlayerSummary => ({ playerId, name, connected });

describe("the cards a phone is dealt", () => {
  it("carry an id, the cleaned title, the credit and the art — never a year, a date or an album", () => {
    const cards = orderCardsFor({
      tracks: [
        track("x", "2011-01-01", { name: "Karma Police - Remastered 2011", artists: ["Radiohead", "Someone"] }),
        track("y", "1989-10-27", { albumName: "1989" }),
      ],
    });
    expect(cards[0]).toEqual({
      id: "x",
      title: "Karma Police",
      artist: "Radiohead, Someone",
      art: "https://i.scdn.co/image/x",
    });
    for (const card of cards) expect(Object.keys(card).sort()).toEqual(["art", "artist", "id", "title"]);
    const wire = JSON.stringify(cards);
    expect(wire).not.toMatch(/2011|1989|release|album/i);
  });

  it("drop art that is not https, as the room does, so the room's copy reads as the same deal", () => {
    const cards = orderCardsFor({ tracks: [track("x", "2000", { albumImageUrl: "http://plain/x" }), track("y", "2001")] });
    expect(cards[0].art).toBe("");
    expect(sameDeal(cards, orderCardsFor({ tracks: [track("x", "2000", { albumImageUrl: "http://plain/x" }), track("y", "2001")] }))).toBe(true);
  });

  it("is the same deal only card for card", () => {
    const cards = orderCardsFor(ROUND);
    expect(sameDeal(cards, cards.map((c) => ({ ...c })))).toBe(true);
    expect(sameDeal(cards, [...cards].reverse())).toBe(false);
    expect(sameDeal(undefined, cards)).toBe(false);
    expect(sameDeal(cards.slice(1), cards)).toBe(false);
  });
});

describe("grading one phone", () => {
  it("gives the whole order the full points and the oldest card alone the consolation", () => {
    expect(gradeArrangement(["a", "b", "c", "d"], ROUND)).toEqual({ verdict: "exact", points: ORDER_EXACT_POINTS });
    expect(gradeArrangement(["a", "c", "b", "d"], ROUND)).toEqual({ verdict: "oldest", points: ORDER_OLDEST_POINTS });
    expect(gradeArrangement(["b", "a", "c", "d"], ROUND)).toEqual({ verdict: "none", points: 0 });
  });

  it("gives nothing for no answer, or for one that is not the round's cards each once", () => {
    expect(gradeArrangement(null, ROUND).verdict).toBe("none");
    expect(gradeArrangement(["a", "a", "c", "d"], ROUND).verdict).toBe("none");
    expect(gradeArrangement(["a", "b", "c"], ROUND).verdict).toBe("none");
    expect(gradeArrangement(["a", "b", "c", "z"], ROUND).verdict).toBe("none");
  });
});

describe("the reveal sent to the room", () => {
  it("names the true order and every year, and grades every seat — every scorer scores", () => {
    const reveal = orderRevealFor(ROUND, ["p1", "p2", "p3", "host"], {
      p1: ["a", "b", "c", "d"],
      p2: ["a", "b", "c", "d"],
      p3: ["a", "d", "c", "b"],
    });
    expect(reveal.order).toEqual(["a", "b", "c", "d"]);
    expect(reveal.years).toEqual({ a: 1971, b: 1985, c: 1999, d: 2012 });
    // Two exact answers both earn the full points: no one-of-each here.
    expect(reveal.results.p1).toEqual({ verdict: "exact", points: ORDER_EXACT_POINTS, locked: true });
    expect(reveal.results.p2).toEqual({ verdict: "exact", points: ORDER_EXACT_POINTS, locked: true });
    expect(reveal.results.p3).toEqual({ verdict: "oldest", points: ORDER_OLDEST_POINTS, locked: true });
    // A seat that never locked in is there, with nothing.
    expect(reveal.results.host).toEqual({ verdict: "none", points: 0, locked: false });
    expect(Object.keys(reveal.results)).toHaveLength(4);
  });

  it("does not read an inherited key as an arrangement", () => {
    const reveal = orderRevealFor(ROUND, ["toString"], {});
    expect(reveal.results.toString).toEqual({ verdict: "none", points: 0, locked: false });
  });

  it("counts the locked answers for order_phone_verdict, and leaves out the seats that never locked", () => {
    const reveal = orderRevealFor(ROUND, ["p1", "p2", "p3", "p4"], {
      p1: ["a", "b", "c", "d"],
      p2: ["a", "c", "b", "d"],
      p3: ["d", "c", "b", "a"],
    });
    expect(phoneVerdictCounts(reveal)).toEqual({ exact: 1, oldest: 1, none: 1 });
  });

  it("reads the room's round for order_round as its best answer", () => {
    const with_ = (arr: Record<string, string[]>) => roomVerdict(orderRevealFor(ROUND, Object.keys(arr), arr));
    expect(with_({ p1: ["a", "b", "c", "d"], p2: ["d", "c", "b", "a"] })).toBe("exact");
    expect(with_({ p1: ["a", "c", "b", "d"], p2: ["d", "c", "b", "a"] })).toBe("partial");
    expect(with_({ p1: ["d", "c", "b", "a"] })).toBe("none");
    expect(roomVerdict(orderRevealFor(ROUND, [], {}))).toBe("none");
  });
});

describe("which phones were in play", () => {
  const players = [
    seat("host", "Host"),
    seat("p1", "Ann"),
    seat("p2", "Bob", false),
    seat("p3", "Cat", false),
  ];

  it("is every seat but the host's that is connected now or has locked in", () => {
    expect(phonesInPlay(players, ["p3"], "host").map((p) => p.playerId)).toEqual(["p1", "p3"]);
  });

  it("buckets the phones as all, some or none, and says nothing when there were none", () => {
    expect(phoneCoverage(["p1", "p3"], ["p1", "p3", "host"])).toBe("all");
    expect(phoneCoverage(["p1", "p3"], ["p3"])).toBe("some");
    expect(phoneCoverage(["p1", "p3"], ["host"])).toBe("none");
    expect(phoneCoverage([], ["host"])).toBeNull();
  });
});

describe("the order page's half", () => {
  const page = readFileSync(join(process.cwd(), "app/order/page.tsx"), "utf8");

  it("deals through orderCardsFor only, so no track field the phone must not see reaches the room", () => {
    expect(page).toMatch(/const cards = orderCardsFor\(current\);/);
    expect(page.match(/hostOrderDeal\(/g) ?? []).toHaveLength(1);
    expect(page).toMatch(/hostOrderDeal\(currentIndex, cards\);/);
  });

  it("never re-deals a round the room already holds, which would wipe every lock", () => {
    expect(page).toMatch(
      /if \(held && held\.round === currentIndex && held\.phase === "arranging" && sameDeal\(held\.cards, cards\)\) return;/
    );
  });

  it("grades at the reveal from the phones when the room answered, and falls back to the host's awards when it never did", () => {
    expect(page).toMatch(/if \(buzzerRoom && roomSnapshot && round\) \{\s*revealToRoom\(round\);\s*return;\s*\}/);
    expect(page).toMatch(/\{phase === "revealed" && !phoneResults && \(/);
  });

  it("puts every scorer's points on the scoreboard by name, after merging the roster", () => {
    expect(page).toMatch(/mergeRoomRoster\(prev, Object\.values\(names\)\)\.map\(/);
    expect(page).toMatch(/const points = earned\.get\(nameKey\(p\.name\)\) \?\? 0;/);
  });
});
