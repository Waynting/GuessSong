import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SOLO_DEFAULT_NAME, setupForWho, soloRoster, whoFromSetup } from "@/lib/who-playing";

const read = (p: string) => readFileSync(p, "utf8");

describe("whoFromSetup", () => {
  it("reads Mixed as mixed whatever the game", () => {
    expect(whoFromSetup({ setupMode: "mixed", playStyle: "order", players: [] })).toBe("mixed");
    expect(whoFromSetup({ setupMode: "mixed", playStyle: "guess", players: ["a", "b"] })).toBe("mixed");
  });

  it("reads the order game with at most one name as someone alone", () => {
    expect(whoFromSetup({ setupMode: "single", playStyle: "order", players: ["", ""] })).toBe("solo");
    expect(whoFromSetup({ setupMode: "single", playStyle: "order", players: ["Ann", " "] })).toBe("solo");
  });

  it("reads a roster on the order game, and every guess game, as a group", () => {
    expect(whoFromSetup({ setupMode: "single", playStyle: "order", players: ["Ann", "Bo"] })).toBe("group");
    expect(whoFromSetup({ setupMode: "single", playStyle: "guess", players: ["", ""] })).toBe("group");
    expect(whoFromSetup({ setupMode: "single", playStyle: "guess", players: ["Ann"] })).toBe("group");
  });
});

describe("setupForWho", () => {
  it("sends someone alone to the order game on one playlist", () => {
    expect(setupForWho("solo", "group")).toEqual({ setupMode: "single", playStyle: "order" });
  });

  it("leaves the game alone for Mixed and for a group that already had one", () => {
    expect(setupForWho("mixed", "solo")).toEqual({ setupMode: "mixed" });
    expect(setupForWho("group", "mixed")).toEqual({ setupMode: "single" });
  });

  it("puts a group arriving from Just me back on the guess game", () => {
    expect(setupForWho("group", "solo")).toEqual({ setupMode: "single", playStyle: "guess" });
  });

  it("round-trips: what a row sets reads back as that row", () => {
    for (const who of ["solo", "group", "mixed"] as const) {
      const set = setupForWho(who, who === "solo" ? "group" : "solo");
      const players = who === "group" ? ["Ann", "Bo"] : [""];
      expect(whoFromSetup({ setupMode: set.setupMode, playStyle: set.playStyle ?? "guess", players })).toBe(who);
    }
  });
});

describe("soloRoster", () => {
  it("is always exactly one name", () => {
    expect(soloRoster(["", "  "])).toEqual([SOLO_DEFAULT_NAME]);
    expect(soloRoster([])).toEqual([SOLO_DEFAULT_NAME]);
    expect(soloRoster(["", " Ann ", "Bo"])).toEqual(["Ann"]);
  });
});

describe("the setup page wiring", () => {
  const page = read("app/page.tsx");

  it("starts a solo game on soloRoster, never on the hidden roster", () => {
    expect(page).toMatch(/const roster = who === "solo" \? soloRoster\(players\) : players;/);
    expect(page).toMatch(/const validPlayers = roster\.filter\(\(p\) => p\.trim\(\)\);/);
  });

  it("derives the row from every restore, so nothing new is stored", () => {
    expect(page).toMatch(/setWho\(whoFromSetup\(form\)\);/);
  });

  it("links the quiz as its own card, not a line under Start", () => {
    expect(page).toMatch(/className="quiz-card"/);
    expect(page).not.toMatch(/className="mode-links"/);
  });
});
