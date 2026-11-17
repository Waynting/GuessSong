import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DAILY_DOOR_COPY } from "@/lib/daily-door";
import { ERROR_LOCALES } from "@/lib/error-messages";
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

const { recordDailyDoor, DAILY_DOOR_STAGES, __resetLivenessForTests } = await import("@/lib/loop-stats");

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const metrics = () => kv.incrs.filter((k) => !k.endsWith(":live")).map((k) => k.replace("loop:stats:2026-11-17:", ""));

beforeEach(() => {
  kv.incrs = [];
  __resetLivenessForTests();
});

describe("the Today's challenge fake door", () => {
  it("has copy in every locale, and the note says it is not built without promising a date", () => {
    for (const locale of ERROR_LOCALES) {
      const copy = DAILY_DOOR_COPY[locale];
      expect(copy.title.length, locale).toBeGreaterThan(0);
      expect(copy.sub.length, locale).toBeGreaterThan(0);
      expect(copy.note, locale).not.toMatch(/soon|tomorrow|next week|即將|明天|下週/i);
    }
    expect(DAILY_DOOR_COPY.en.note).toMatch(/isn't built yet/);
    expect(DAILY_DOOR_COPY.zh.note).toMatch(/還沒有做/);
    expect(DAILY_DOOR_COPY.en.title).not.toBe(DAILY_DOOR_COPY.zh.title);
  });

  it("imports nothing at runtime, because the setup page bundles it", () => {
    expect(read("lib/daily-door.ts")).not.toMatch(/^import (?!type )/m);
  });

  it("counts shown and tapped once per page load, in a closed set", async () => {
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

  it("is drawn after mount, reports shown from an effect and tapped once, and starts nothing", () => {
    const page = code(read("app/page.tsx"));
    expect(page).toMatch(/if \(mounted\) reportDailyDoor\("shown"\);/);
    expect(page).toMatch(/if \(dailyDoorTappedRef\.current\) return;\s*dailyDoorTappedRef\.current = true;\s*reportDailyDoor\("tapped"\);/);
    expect(page).toMatch(/\{mounted && \(\s*<div lang=/);
    const opener = page.match(/function openDailyDoor\(\) \{[\s\S]*?\n {2}\}/)?.[0] ?? "";
    expect(opener).not.toMatch(/router|handleStart|saveGame|fetch\(/);
  });

  it("routes the pulse to its recorder and is printed by npm run stats", () => {
    expect(read("app/api/pulse/route.ts")).toMatch(/case "daily_door":\s*await recordDailyDoor\(event\.stage\);/);
    const script = read("scripts/loop-stats.mjs");
    const rendered = script.match(/const RENDERED_PREFIXES = \[([^\]]*)\]/)?.[1] ?? "";
    expect(rendered).toContain('"daily_door:"');
    expect(script).toMatch(/Today's challenge \(fake door\)/);
  });
});
