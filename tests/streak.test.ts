import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { installQuotaStorage, installStorage, installThrowingStorage } from "./helpers/storage";
import {
  BESTS_KEY,
  BESTS_MAX,
  BEST_OUTCOMES,
  STREAK_BANDS,
  STREAK_KEY,
  dayNumber,
  isBestOutcome,
  isStreakBand,
  localDayKey,
  nextBest,
  nextStreak,
  parseBests,
  parseStreak,
  streakBand,
  streakLine,
  takeStreakResult,
  type BestEntry,
} from "@/lib/streak";
import { buildGamePayload, parseGamePayload } from "@/lib/game-session";
import { parsePulse } from "@/lib/pulse";

const kv = vi.hoisted(() => ({ incrs: [] as string[] }));

vi.mock("@/lib/kv", () => ({
  dayBucket: () => "2026-11-17",
  getKvStore: async () => ({
    async incr(key: string) {
      kv.incrs.push(key);
      return 1;
    },
  }),
}));

const { recordGameEnd, __resetLivenessForTests } = await import("@/lib/loop-stats");

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const metrics = () =>
  kv.incrs.filter((k) => !k.endsWith(":live")).map((k) => k.replace("loop:stats:2026-11-17:", ""));

const REF_A = "7axyIwzJZsCS6M9PlwQp1U";
const REF_B = "album:4aawyAB9vmqN3uQ7FjRGTy";
const ref = (i: number) => `${String(i).padStart(2, "0")}${"a".repeat(20)}`;

let store: Map<string, string>;

beforeEach(() => {
  store = installStorage();
  kv.incrs = [];
  __resetLivenessForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the day rule: consecutive local calendar days with a Game Over", () => {
  it("starts at one, holds on the same day, grows on the next, resets after a gap", () => {
    const first = nextStreak(null, "2026-11-17");
    expect(first).toEqual({ day: "2026-11-17", count: 1 });
    expect(nextStreak(first, "2026-11-17")).toEqual(first);
    const second = nextStreak(first, "2026-11-18");
    expect(second).toEqual({ day: "2026-11-18", count: 2 });
    expect(nextStreak(second, "2026-11-19")).toEqual({ day: "2026-11-19", count: 3 });
    expect(nextStreak(second, "2026-11-20")).toEqual({ day: "2026-11-20", count: 1 });
  });

  it("does not grow, reset or move back when the clock reads an earlier day", () => {
    const state = { day: "2026-11-17", count: 4 };
    expect(nextStreak(state, "2026-11-16")).toEqual(state);
    expect(nextStreak(state, "2025-01-01")).toEqual(state);
    // Corrected forward again: the stored day is still the reference.
    expect(nextStreak(nextStreak(state, "2026-11-16"), "2026-11-18")).toEqual({ day: "2026-11-18", count: 5 });
  });

  it("crosses month, year and leap-day boundaries as one day", () => {
    expect(nextStreak({ day: "2026-11-30", count: 1 }, "2026-12-01").count).toBe(2);
    expect(nextStreak({ day: "2026-12-31", count: 1 }, "2027-01-01").count).toBe(2);
    expect(nextStreak({ day: "2028-02-28", count: 1 }, "2028-02-29").count).toBe(2);
    expect(nextStreak({ day: "2027-02-28", count: 1 }, "2027-03-01").count).toBe(2);
  });

  it("keys the device's local day, so a DST night is still one day apart", () => {
    // Local midnights around a DST change are 23 or 25 hours apart; the day
    // number is counted on the calendar fields, not on the elapsed hours.
    const beforeMidnight = new Date(2026, 2, 7, 23, 59);
    const afterMidnight = new Date(2026, 2, 8, 0, 1);
    expect(localDayKey(beforeMidnight)).toBe("2026-03-07");
    expect(localDayKey(afterMidnight)).toBe("2026-03-08");
    expect(dayNumber("2026-03-08")! - dayNumber("2026-03-07")!).toBe(1);
    expect(dayNumber("2026-11-01")! - dayNumber("2026-10-31")!).toBe(1);
    // A late game and an early one the next morning: two days, a streak of two.
    const late = nextStreak(null, localDayKey(new Date(2026, 9, 31, 23, 58)));
    expect(nextStreak(late, localDayKey(new Date(2026, 10, 1, 0, 2))).count).toBe(2);
  });

  it("rejects a day that does not exist", () => {
    for (const bad of ["2026-02-31", "2026-13-01", "2026-00-10", "26-11-17", "2026-11-17T00:00", ""]) {
      expect(dayNumber(bad), bad).toBeNull();
    }
  });

  it("bands the run into a closed set", () => {
    expect([1, 2, 3, 6, 7, 400].map(streakBand)).toEqual(["d1", "d2", "d3_6", "d3_6", "d7_plus", "d7_plus"]);
    expect(STREAK_BANDS.every(isStreakBand)).toBe(true);
    expect(isStreakBand("d8")).toBe(false);
  });
});

describe("the best rule: per playlist, bounded", () => {
  const NOW = 1_800_000_000_000;

  it("first, new, tied, below", () => {
    const first = nextBest([], REF_A, 5, NOW);
    expect(first).toMatchObject({ outcome: "first", best: 5, previous: null });
    expect(nextBest(first.entries, REF_A, 9, NOW + 1)).toMatchObject({ outcome: "new", best: 9, previous: 5 });
    expect(nextBest(first.entries, REF_A, 5, NOW + 1)).toMatchObject({ outcome: "tied", best: 5 });
    expect(nextBest(first.entries, REF_A, 2, NOW + 1)).toMatchObject({ outcome: "below", best: 5, previous: 5 });
    expect(BEST_OUTCOMES.every(isBestOutcome)).toBe(true);
  });

  it("keeps each playlist's best apart", () => {
    const a = nextBest([], REF_A, 9, NOW);
    const b = nextBest(a.entries, REF_B, 3, NOW + 1);
    expect(b.outcome).toBe("first");
    expect(nextBest(b.entries, REF_A, 4, NOW + 2)).toMatchObject({ outcome: "below", best: 9 });
  });

  it("holds at most BESTS_MAX, evicting the playlist least recently played", () => {
    let entries: BestEntry[] = [];
    for (let i = 0; i < BESTS_MAX + 5; i++) entries = nextBest(entries, ref(i), i, NOW + i).entries;
    expect(entries).toHaveLength(BESTS_MAX);
    expect(entries.some((e) => e.ref === ref(0))).toBe(false);
    // Playing the oldest survivor again touches it, so it is not the next to go.
    entries = nextBest(entries, ref(5), 1, NOW + 100).entries;
    entries = nextBest(entries, ref(99), 1, NOW + 101).entries;
    expect(entries.some((e) => e.ref === ref(5))).toBe(true);
    expect(entries.some((e) => e.ref === ref(6))).toBe(false);
  });
});

describe("repair: field by field, never wholesale", () => {
  it("keeps a readable day under a corrupted count, drops an unreadable day", () => {
    expect(parseStreak(JSON.stringify({ day: "2026-11-17", count: 3 }))).toEqual({ day: "2026-11-17", count: 3 });
    expect(parseStreak(JSON.stringify({ day: "2026-11-17", count: "lots" }))).toEqual({ day: "2026-11-17", count: 1 });
    expect(parseStreak(JSON.stringify({ day: "2026-11-17", count: -2 }))).toEqual({ day: "2026-11-17", count: 1 });
    for (const junk of [null, "", "{", "[]", "42", JSON.stringify({ day: "yesterday", count: 3 })]) {
      expect(parseStreak(junk), String(junk)).toBeNull();
    }
  });

  it("keeps every best entry that reads and drops the rest", () => {
    const raw = JSON.stringify([
      { ref: REF_A, score: 7, at: 10 },
      { ref: "not a ref", score: 7, at: 11 },
      { ref: REF_B, score: -1, at: 12 },
      { ref: REF_B, score: 4 },
      { ref: REF_A, score: 9, at: 5 },
      "junk",
      null,
    ]);
    const parsed = parseBests(raw);
    expect(parsed.map((e) => [e.ref, e.score])).toEqual([
      [REF_A, 9],
      [REF_B, 4],
    ]);
    expect(parseBests("{not json")).toEqual([]);
    expect(parseBests(JSON.stringify({ ref: REF_A }))).toEqual([]);
  });

  it("trims an oversized stored list to BESTS_MAX", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ ref: ref(i), score: 1, at: i + 1 }));
    expect(parseBests(JSON.stringify(many))).toHaveLength(BESTS_MAX);
  });
});

describe("the storage half", () => {
  it("is a canary: the stub storage is really installed", () => {
    window.localStorage.setItem("canary", "1");
    expect(store.get("canary")).toBe("1");
  });

  it("writes the run and the best, and a second Game Over the same day does not count twice", () => {
    const day1 = new Date(2026, 10, 17, 20, 0);
    const first = takeStreakResult({ ref: REF_A, score: 6 }, day1);
    expect(first).toEqual({ streak: 1, band: "d1", best: { outcome: "first", score: 6, best: 6, previous: null } });
    // The reload that restarts at round one, played out again the same evening.
    const again = takeStreakResult({ ref: REF_A, score: 8 }, new Date(2026, 10, 17, 21, 0));
    expect(again).toMatchObject({ streak: 1, best: { outcome: "new", best: 8, previous: 6 } });
    const next = takeStreakResult({ ref: REF_A, score: 8 }, new Date(2026, 10, 18, 9, 0));
    expect(next).toMatchObject({ streak: 2, band: "d2", best: { outcome: "tied" } });
    expect(JSON.parse(store.get(STREAK_KEY)!)).toEqual({ day: "2026-11-18", count: 2 });
    expect(JSON.parse(store.get(BESTS_KEY)!)).toHaveLength(1);
  });

  it("writes no best without a single playlist, and still counts the day", () => {
    const result = takeStreakResult({ ref: undefined, score: 6 }, new Date(2026, 10, 17));
    expect(result).toEqual({ streak: 1, band: "d1", best: null });
    expect(store.has(BESTS_KEY)).toBe(false);
    expect(takeStreakResult({ ref: "garbage", score: 6 }).best).toBeNull();
  });

  it("repairs what it reads before it writes", () => {
    store.set(STREAK_KEY, JSON.stringify({ day: "2026-11-16", count: "x" }));
    store.set(BESTS_KEY, "[{]");
    const result = takeStreakResult({ ref: REF_A, score: 3 }, new Date(2026, 10, 17));
    expect(result).toMatchObject({ streak: 2, best: { outcome: "first" } });
  });

  it("never throws when the browser refuses storage, and reads day one", () => {
    installThrowingStorage();
    expect(() => takeStreakResult({ ref: REF_A, score: 3 })).not.toThrow();
    expect(takeStreakResult({ ref: REF_A, score: 3 })).toMatchObject({ streak: 1, best: { outcome: "first" } });
    installQuotaStorage();
    expect(() => takeStreakResult({ ref: REF_A, score: 3 })).not.toThrow();
  });
});

describe("the line on screen", () => {
  it("says what a streak is on day one, and names the playlist's best after", () => {
    expect(streakLine({ streak: 1, band: "d1", best: null }, "Decades")).toBe(
      "Day 1 — come back tomorrow to start a streak"
    );
    expect(
      streakLine({ streak: 3, band: "d3_6", best: { outcome: "new", score: 9, best: 9, previous: 7 } }, "Decades")
    ).toBe("🔥 3-day streak · Best on Decades: 9 — new best!");
    expect(
      streakLine({ streak: 2, band: "d2", best: { outcome: "below", score: 4, best: 9, previous: 9 } }, "Decades")
    ).toBe("🔥 2-day streak · Best on Decades: 9");
    expect(
      streakLine({ streak: 2, band: "d2", best: { outcome: "tied", score: 9, best: 9, previous: 9 } }, "Decades")
    ).toMatch(/tied your best$/);
  });

  it("cuts a long playlist name by code point", () => {
    const line = streakLine(
      { streak: 2, band: "d2", best: { outcome: "first", score: 1, best: 1, previous: null } },
      "🎵".repeat(40)
    );
    expect(line).toContain("…");
    expect(line).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe("the payload carries the ref", () => {
  const base = {
    tracks: [{ id: "t1", name: "Song", artists: ["A"], albumName: "X", albumArt: "", durationMs: 1 }],
    players: [{ name: "Me", score: 0 }],
    playlistName: "P",
    clipDuration: 15,
    playlistSource: "own" as const,
    mode: "order" as const,
  };

  it("round-trips a ref and drops an unreadable one rather than the game", () => {
    const stored = JSON.stringify(buildGamePayload({ ...base, playlistRef: REF_B } as never));
    expect(parseGamePayload(stored)?.playlistRef).toBe(REF_B);
    const junk = JSON.stringify({ ...JSON.parse(stored), playlistRef: "../../etc" });
    const parsed = parseGamePayload(junk);
    expect(parsed).not.toBeNull();
    expect(parsed?.playlistRef).toBeUndefined();
  });

  it("is set by the single-link start only", () => {
    const page = read("app/page.tsx");
    expect(page.match(/playlistRef:/g)).toHaveLength(1);
    expect(page).toMatch(/\.\.\.\(currentPlaylistId \? \{ playlistRef: currentPlaylistId \} : \{\}\),/);
  });
});

describe("the wire and the counters", () => {
  it("parses a known band and outcome and drops unknown ones without dropping the end", () => {
    expect(
      parsePulse({ kind: "game_finished", end: "played_out", roundsPlayed: 5, players: "p1", streak: "d2", best: "new" })
    ).toEqual({ kind: "game_finished", end: "played_out", roundsPlayed: 5, players: "p1", streak: "d2", best: "new" });
    expect(
      parsePulse({ kind: "game_finished", end: "played_out", roundsPlayed: 5, streak: "d99", best: "__proto__" })
    ).toEqual({ kind: "game_finished", end: "played_out", roundsPlayed: 5 });
  });

  it("writes streak:<band> and personal_best:<outcome> for a game of one only", async () => {
    await recordGameEnd("played_out", 5, { players: "p1", streak: "d3_6", best: "tied" });
    expect(metrics()).toEqual(expect.arrayContaining(["streak:d3_6", "personal_best:tied"]));

    for (const details of [
      { players: "p2", streak: "d2", best: "new" },
      { streak: "d2", best: "new" },
      { players: "p1", streak: "d9", best: "great" },
    ] as const) {
      kv.incrs = [];
      await recordGameEnd("played_out", 5, details as never);
      expect(
        metrics().some((m) => m.startsWith("streak:") || m.startsWith("personal_best:")),
        JSON.stringify(details)
      ).toBe(false);
      expect(metrics()).toContain("game_end:played_out");
    }
  });

  it("is sent on the end beacon and passed through by the route", () => {
    const client = read("lib/loop-client.ts");
    expect(client).toMatch(/\.\.\.\(details\.streak \? \{ streak: details\.streak \} : \{\}\),/);
    expect(client).toMatch(/\.\.\.\(details\.best \? \{ best: details\.best \} : \{\}\),/);
    const route = read("app/api/pulse/route.ts");
    expect(route).toMatch(/streak: event\.streak,\s*best: event\.best,/);
  });
});

describe("both Game Over screens, solo only", () => {
  for (const page of ["app/order/page.tsx", "app/game/page.tsx"]) {
    it(`${page} writes once inside the end guard, for one player, and renders the line`, () => {
      const src = read(page);
      expect(src.match(/takeStreakResult\(/g)).toHaveLength(1);
      const guard = src.indexOf("function trackGameFinished");
      const once = src.indexOf("finishedTrackedRef.current = true;", guard);
      const take = src.indexOf("takeStreakResult(", guard);
      expect(guard).toBeGreaterThan(0);
      expect(take).toBeGreaterThan(once);
      expect(src).toMatch(/players\.length === 1 && roundsPlayed >= 1\s*\?\s*takeStreakResult\(\{ ref: playlistRefRef\.current, score: players\[0\]\.score \}\)/);
      expect(src).toMatch(/\.\.\.\(soloStreak \? \{ streak: soloStreak\.band \} : \{\}\),/);
      expect(src).toMatch(/\.\.\.\(soloStreak\?\.best \? \{ best: soloStreak\.best\.outcome \} : \{\}\),/);
      expect(src).toMatch(/\{streakResult && \(/);
      expect(src).toMatch(/\{streakLine\(streakResult, playlistName\)\}/);
      // Under the scores, above Play Again.
      const line = src.indexOf("{streakResult && (");
      const playAgain = src.indexOf('onClick={playAgain}');
      const scores = src.indexOf('className="final-scoreboard"');
      expect(line).toBeGreaterThan(scores);
      expect(line).toBeLessThan(playAgain);
    });
  }
});

describe("npm run stats", () => {
  it("prints the streak block and claims both prefixes", () => {
    const script = read("scripts/loop-stats.mjs");
    const rendered = script.match(/const RENDERED_PREFIXES = \[([^\]]*)\]/)?.[1] ?? "";
    expect(rendered).toContain('"streak:"');
    expect(rendered).toContain('"personal_best:"');
    expect(script).toMatch(/Streaks \(one-player Game Overs\)/);
    for (const band of STREAK_BANDS) expect(script).toContain(`"streak:${band}"`);
    for (const outcome of BEST_OUTCOMES) expect(script).toContain(`"${outcome}"`);
  });
});
