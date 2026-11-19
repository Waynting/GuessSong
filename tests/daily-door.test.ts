import { describe, it, expect, beforeEach, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePulse } from "@/lib/pulse";

/**
 * The "Today's challenge" fake door, retired 2026-11-19: it cleared its 3% bar
 * (7.8%) and the real daily challenge replaced it (tests/daily.test.ts). Its
 * counters stay readable — recorder, pulse and stats line — and nothing on the
 * site sends them.
 */

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

const { recordDailyDoor, DAILY_DOOR_STAGES, __resetLivenessForTests } = await import("@/lib/loop-stats");

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const metrics = () => kv.incrs.filter((k) => !k.endsWith(":live")).map((k) => k.replace("loop:stats:2026-11-17:", ""));

beforeEach(() => {
  kv.incrs = [];
  __resetLivenessForTests();
});

describe("the retired Today's challenge fake door", () => {
  it("is gone from the page: no copy module, no card, no report", () => {
    expect(existsSync(join(process.cwd(), "lib/daily-door.ts"))).toBe(false);
    const page = code(read("app/setup-page.tsx"));
    expect(page).not.toMatch(/daily-door|DAILY_DOOR|reportDailyDoor|openDailyDoor/);
    expect(code(read("lib/loop-client.ts"))).not.toMatch(/reportDailyDoor|kind: "daily_door"/);
    expect(read("components/setup-chrome.tsx")).not.toMatch(/\.daily-door/);
  });

  it("still records and parses its closed set, so the history stays readable", async () => {
    expect(DAILY_DOOR_STAGES).toEqual(["shown", "tapped"]);
    for (const stage of DAILY_DOOR_STAGES) {
      kv.incrs = [];
      await recordDailyDoor(stage);
      expect(metrics()).toEqual([`daily_door:${stage}`]);
    }
    expect(parsePulse({ kind: "daily_door", stage: "tapped" })).toEqual({ kind: "daily_door", stage: "tapped" });
    expect(parsePulse({ kind: "daily_door", stage: "opened" })).toBeNull();
    expect(parsePulse({ kind: "daily_door" })).toBeNull();
  });

  it("routes the pulse to its recorder and is printed by npm run stats, marked retired", () => {
    expect(read("app/api/pulse/route.ts")).toMatch(/case "daily_door":\s*await recordDailyDoor\(event\.stage\);/);
    const script = read("scripts/loop-stats.mjs");
    const rendered = script.match(/const RENDERED_PREFIXES = \[([^\]]*)\]/)?.[1] ?? "";
    expect(rendered).toContain('"daily_door:"');
    expect(script).toMatch(/Today's challenge \(fake door, retired 2026-11-19\)/);
  });
});
