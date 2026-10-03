import { describe, expect, it } from "vitest";
import { DEFAULT_DAYS, MAX_DAYS, parseWindow } from "../scripts/stats-window.mjs";

const NOW = new Date("2026-10-03T08:00:00Z");
const parse = (...argv: string[]) => parseWindow(argv, NOW);

describe("npm run stats window", () => {
  it("defaults to a week ending today", () => {
    expect(parse()).toEqual({ days: DEFAULT_DAYS, since: "2026-09-27" });
  });

  it("keeps the bare number it always took", () => {
    expect(parse("3")).toEqual({ days: 3, since: "2026-10-01" });
    expect(parse("30").days).toBe(30);
  });

  it("names the common windows", () => {
    expect(parse("--today")).toEqual({ days: 1, since: "2026-10-03" });
    expect(parse("--week").days).toBe(7);
    expect(parse("--month").days).toBe(MAX_DAYS);
    expect(parse("--all").days).toBe(MAX_DAYS);
    expect(parse("--days", "14").days).toBe(14);
    expect(parse("--days=14").days).toBe(14);
  });

  it("reads --since as that UTC day through today", () => {
    expect(parse("--since", "2026-09-30")).toEqual({ days: 4, since: "2026-09-30" });
    expect(parse("--since=2026-10-03")).toEqual({ days: 1, since: "2026-10-03" });
  });

  it("refuses what it cannot honour rather than guessing", () => {
    for (const argv of [
      ["0"],
      ["31"],
      ["--days"],
      ["--days", "x"],
      ["--since", "2026-10-04"],
      ["--since", "2026-08-01"],
      ["--since", "2026-02-30"],
      ["--since", "10/01"],
      ["--week", "--month"],
      ["--yesterday"],
    ]) {
      expect(parse(...argv), argv.join(" ")).toHaveProperty("error");
    }
  });

  it("answers --help before anything else", () => {
    expect(parse("--help")).toEqual({ help: true });
    expect(parse("-h")).toEqual({ help: true });
  });
});
