// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { showSoloNudge } from "@/lib/solo-nudge";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** The source with its comments removed, so a rule named in prose does not pass for one in code. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("when the setup page offers the order game to a host alone", () => {
  const base = { setupMode: "single" as const, buzzerEnabled: false, playStyle: "guess" as const };

  it("waits for exactly one typed name, blanks not counted", () => {
    // The default roster is two blank rows: one name typed into it is the case.
    expect(showSoloNudge({ ...base, players: ["Ann", ""] })).toBe(true);
    expect(showSoloNudge({ ...base, players: ["Ann"] })).toBe(true);
    expect(showSoloNudge({ ...base, players: ["", ""] })).toBe(false);
    expect(showSoloNudge({ ...base, players: ["  ", ""] })).toBe(false);
    expect(showSoloNudge({ ...base, players: ["Ann", "Ben"] })).toBe(false);
    expect(showSoloNudge({ ...base, players: ["Ann", "Ben", "Cleo"] })).toBe(false);
  });

  it("is never shown where there is no roster to sit under, already in Mixed, or already on the order game", () => {
    const players = ["Ann", ""];
    expect(showSoloNudge({ ...base, buzzerEnabled: true, players })).toBe(false);
    expect(showSoloNudge({ ...base, setupMode: "mixed", players })).toBe(false);
    expect(showSoloNudge({ ...base, playStyle: "order", players })).toBe(false);
  });

  it("never fires together with the Mixed nudge — one name against three", () => {
    // Both sit in the same slot under the roster. Three names is the Mixed
    // nudge's floor and one is this one's whole condition.
    expect(showSoloNudge({ ...base, players: ["Ann", "Ben", "Cleo"] })).toBe(false);
  });
});

describe("the setup page's wiring", () => {
  const body = code(read("app/page.tsx"));

  it("draws the nudge from showSoloNudge, under the roster, beside the Mixed nudge", () => {
    expect(body).toMatch(
      /const soloNudge = showSoloNudge\(\{ setupMode, buzzerEnabled, players, playStyle \}\)/
    );
    const addPlayer = body.indexOf("Add Player");
    const mixed = body.indexOf('className="mixed-nudge"');
    const solo = body.indexOf('className="solo-nudge"');
    expect(solo).toBeGreaterThan(mixed);
    expect(mixed).toBeGreaterThan(addPlayer);
  });

  it("counts shown once per page load, and a tap before switching the play style", () => {
    const effect = body.slice(body.indexOf("useEffect(() => {\n    if (!soloNudge"));
    expect(effect).toMatch(
      /soloNudgeShownRef\.current\) return;\s*soloNudgeShownRef\.current = true;\s*reportSoloNudge\("shown"\)/
    );
    expect(body).toMatch(
      /soloNudgeTappedRef\.current = true;\s*reportSoloNudge\("tapped"\);\s*choosePlayStyle\("order"\)/
    );
  });

  it("credits an order start to the nudge where every hosted start is counted", () => {
    const start = body.slice(body.indexOf("function recordHostedStart("));
    const credit = start.indexOf('reportSoloNudge("started")');
    expect(credit).toBeGreaterThan(-1);
    expect(start.slice(0, credit)).toMatch(/if \(mode === "order" && soloNudgeTappedRef\.current\)/);
  });

  it("styles it for a finger: hover behind a hover query, and an immediate pressed state", () => {
    const css = read("components/setup-chrome.tsx");
    expect(css).toMatch(/@media \(hover: hover\) \{\s*\.solo-nudge:hover/);
    expect(css).toMatch(/\.solo-nudge:active \{[^}]*transition: none/);
  });
});
