import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
import { MUSIC_AGE_WEIGHTS, decadeLabel, musicAge, musicAgeCopy, type MusicAgeRound } from "@/lib/music-age";
import { LOOP_SURFACES } from "@/lib/loop-links";
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

const { recordMusicAge, MUSIC_AGE_OUTCOMES, __resetLivenessForTests } = await import("@/lib/loop-stats");

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const NOW = new Date("2026-11-17T12:00:00.000Z");
const metrics = () => kv.incrs.filter((k) => !k.endsWith(":live")).map((k) => k.replace("loop:stats:2026-11-17:", ""));

const cards = (...years: (number | null)[]) => years.map((y) => ({ releaseDate: y === null ? undefined : `${y}-06-01` }));
const round = (verdict: MusicAgeRound["verdict"], ...years: (number | null)[]): MusicAgeRound => ({
  verdict,
  tracks: cards(...years),
});

beforeEach(() => {
  kv.incrs = [];
  __resetLivenessForTests();
});

describe("the year: the rounds you got right, weighted by how right", () => {
  it("averages the cards of a fully called round", () => {
    expect(musicAge([round("exact", 1980, 1985, 1990, 1995)], NOW)).toEqual({ year: 1988, decade: "the late '80s" });
  });

  it("counts an oldest-only round at half weight and a missed round not at all", () => {
    expect(MUSIC_AGE_WEIGHTS).toEqual({ exact: 1, partial: 0.5, none: 0 });
    // exact: 1980×2 at 1; partial: 2000×2 at 0.5 → (3960 + 2000) / 3 = 1986.67
    const age = musicAge(
      [round("exact", 1980, 1980), round("partial", 2000, 2000), round("none", 2020, 2020, 2020)],
      NOW
    );
    expect(age?.year).toBe(1987);
  });

  it("is null when no round scored, so the page renders nothing", () => {
    expect(musicAge([], NOW)).toBeNull();
    expect(musicAge([round("none", 1990, 2000)], NOW)).toBeNull();
    // A scored round whose cards carry no usable year has nothing to say either.
    expect(musicAge([round("exact", null, null)], NOW)).toBeNull();
  });

  it("skips undated cards rather than reading them as year zero", () => {
    expect(musicAge([round("exact", 1990, null, 1990)], NOW)?.year).toBe(1990);
  });

  it("labels the decade early, mid or late, with the apostrophe only before 2000", () => {
    expect(decadeLabel(1980)).toBe("the early '80s");
    expect(decadeLabel(1983)).toBe("the early '80s");
    expect(decadeLabel(1984)).toBe("the mid '80s");
    expect(decadeLabel(1986)).toBe("the mid '80s");
    expect(decadeLabel(1987)).toBe("the late '80s");
    expect(decadeLabel(1909)).toBe("the late '00s");
    expect(decadeLabel(2003)).toBe("the early 2000s");
    expect(decadeLabel(2018)).toBe("the late 2010s");
    expect(decadeLabel(2025)).toBe("the mid 2020s");
  });

  it("says 'your' alone and 'this room's' with company, and the share text names the year and decade", () => {
    const age = { year: 1987, decade: "the late '80s" };
    const solo = musicAgeCopy(age, false);
    expect(solo.headline).toBe("Your ears live in 1987");
    expect(solo.button).toBe("Share my music age");
    expect(solo.shareText).toBe("My ears live in 1987 (the late '80s). What year are yours?");
    expect(musicAgeCopy(age, true).headline).toBe("This room's ears live in 1987");
    expect(solo.line).toContain("the late '80s");
  });
});

describe("the wire and the counter", () => {
  it("is a loop surface of its own, with its tap outcomes in a closed set", async () => {
    expect(LOOP_SURFACES).toContain("music_age");
    expect(parsePulse({ kind: "music_age", outcome: "shared" })).toEqual({ kind: "music_age", outcome: "shared" });
    expect(parsePulse({ kind: "music_age", outcome: "1987" })).toBeNull();
    expect(parsePulse({ kind: "music_age" })).toBeNull();
    for (const outcome of MUSIC_AGE_OUTCOMES) {
      kv.incrs = [];
      await recordMusicAge(outcome);
      expect(metrics()).toEqual([`music_age:${outcome}`]);
    }
    kv.incrs = [];
    await recordMusicAge("1987" as never);
    expect(metrics()).toEqual([]);
  });

  it("is recorded by the pulse route", () => {
    expect(read("app/api/pulse/route.ts")).toMatch(/case "music_age":\s*await recordMusicAge\(event\.outcome\);/);
  });
});

describe("the card", () => {
  it("renders on the order Game Over only behind the computed age, above the onward offers", () => {
    const page = read("app/order/page.tsx");
    expect(page).toContain("{ears && <MusicAgeCard age={ears} room={!solo} />}");
    expect(page.match(/<MusicAgeCard /g)).toHaveLength(1);
    expect(page).toMatch(/const ears = phase === "finished" \? musicAge\(closedRounds\) : null;/);
    expect(page.indexOf("<MusicAgeCard ")).toBeLessThan(page.indexOf("<SoloInvite "));
  });

  it("keeps the rounds from closeRound's own verdicts, not a second grading path", () => {
    const page = read("app/order/page.tsx");
    const body = page.slice(page.indexOf("function closeRound()"), page.indexOf("function trackGameFinished"));
    expect(body.match(/keep\(verdict\)/g)).toHaveLength(2);
    expect(body).toMatch(/const verdict = roomVerdict\(phoneRound\.reveal\);\s*reportOrderRound\(verdict,/);
    expect(body).toMatch(/const verdict = orderVerdict\([^)]*\);\s*reportOrderRound\(verdict,/);
  });

  it("reports its impression on mount and shares the counting redirect's URL, never the tab's", () => {
    const src = read("components/music-age.tsx");
    expect(src).toMatch(/reportLoopImpression\("music_age"\)/);
    expect(src).toMatch(/loopUrl\("music_age"\)/);
    expect(src).toMatch(/reportMusicAge\(outcome\)/);
    expect(src).toMatch(/className="btn-ghost compact"/);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/window\.location/);
  });

  it("is printed by npm run stats, not left in Other counters", () => {
    const script = read("scripts/loop-stats.mjs");
    const rendered = script.match(/const RENDERED_PREFIXES = \[([^\]]*)\]/)?.[1] ?? "";
    expect(rendered).toContain('"music_age:"');
    expect(script).toMatch(/Music age {2}shown/);
  });
});
