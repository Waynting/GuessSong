// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MIXED_NUDGE_MIN_PLAYERS, showMixedNudge } from "@/lib/mixed-nudge";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** The source with its comments removed, so a rule named in prose does not pass for one in code. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("when the setup page offers Mixed mode", () => {
  const base = { setupMode: "single" as const, buzzerEnabled: false };

  it("waits for a room's worth of typed names, blanks not counted", () => {
    expect(MIXED_NUDGE_MIN_PLAYERS).toBe(3);
    expect(showMixedNudge({ ...base, players: ["Ann", "Ben"] })).toBe(false);
    expect(showMixedNudge({ ...base, players: ["Ann", "Ben", "  ", ""] })).toBe(false);
    expect(showMixedNudge({ ...base, players: ["Ann", "Ben", "Cleo"] })).toBe(true);
  });

  it("is never shown where there is no roster to sit under, or already in Mixed", () => {
    const players = ["Ann", "Ben", "Cleo", "Dev"];
    expect(showMixedNudge({ ...base, buzzerEnabled: true, players })).toBe(false);
    expect(showMixedNudge({ ...base, setupMode: "mixed", players })).toBe(false);
  });
});

describe("the setup page's wiring", () => {
  const body = code(read("app/page.tsx"));

  it("draws the nudge from showMixedNudge, under the roster", () => {
    expect(body).toMatch(/const mixedNudge = showMixedNudge\(\{ setupMode, buzzerEnabled, players \}\)/);
    const addPlayer = body.indexOf("Add Player");
    const nudge = body.indexOf('className="mixed-nudge"');
    expect(nudge).toBeGreaterThan(addPlayer);
  });

  it("counts shown once per page load, and a tap before switching the mode", () => {
    const effect = body.slice(body.indexOf("useEffect(() => {\n    if (!mixedNudge"));
    expect(effect).toMatch(/nudgeShownRef\.current\) return;\s*nudgeShownRef\.current = true;\s*reportMixedNudge\("shown"\)/);
    expect(body).toMatch(/nudgeTappedRef\.current = true;\s*reportMixedNudge\("tapped"\);\s*chooseMode\("mixed"\)/);
  });

  it("credits a Mixed start to the nudge where every hosted start is counted", () => {
    const start = body.slice(body.indexOf("function recordHostedStart("));
    const credit = start.indexOf('reportMixedNudge("started")');
    expect(credit).toBeGreaterThan(-1);
    expect(start.slice(0, credit)).toMatch(/if \(mixed && nudgeTappedRef\.current\)/);
  });

  it("styles it for a finger: hover behind a hover query, and an immediate pressed state", () => {
    const css = read("components/setup-chrome.tsx");
    expect(css).toMatch(/@media \(hover: hover\) \{\s*\.mixed-nudge:hover/);
    expect(css).toMatch(/\.mixed-nudge:active \{[^}]*transition: none/);
  });
});
