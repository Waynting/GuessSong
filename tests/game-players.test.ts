// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GAME_SCORED, PLAYER_BANDS, gameScored, playerBand } from "@/lib/game-players";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** The source with its comments removed, so a rule named in prose does not pass for one in code. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("the scoreboard's band", () => {
  it("folds nobody and one player together, then a duel, a small room, a big one", () => {
    expect([0, 1, 2, 3, 4, 5, 12].map(playerBand)).toEqual([
      "p1", "p1", "p2", "p3_4", "p3_4", "p5_plus", "p5_plus",
    ]);
    expect(playerBand(Number.NaN)).toBe("p1");
    expect(playerBand(-3)).toBe("p1");
    expect(PLAYER_BANDS).toEqual(["p1", "p2", "p3_4", "p5_plus"]);
  });

  it("reads a game as scored once any award has landed", () => {
    expect(gameScored([])).toBe("unscored");
    expect(gameScored([{ score: 0 }, { score: 0 }])).toBe("unscored");
    expect(gameScored([{ score: 0 }, { score: 1 }])).toBe("scored");
    expect(GAME_SCORED).toEqual(["scored", "unscored"]);
  });

  it("is a module with no imports, so the game pages can hold it", () => {
    expect(read("lib/game-players.ts")).not.toMatch(/^import /m);
  });
});

describe("the pages send both, on every path", () => {
  it("the setup page bands the same count GA4's player_count gets, on all three starts", () => {
    const body = code(read("app/page.tsx"));
    expect(body).toMatch(/reportGameStart\(hostGameIndex, mixed, setupSource, mode, playerBand\(playerCount\)\)/);
    expect(body).toMatch(/recordHostedStart\("room", gameMode\(Boolean\(room\)\), data\.players\.length\)/);
    expect(body).toMatch(/recordHostedStart\("phone", gameMode\(Boolean\(room\)\), mixedContributions\.length\)/);
    expect(body).toMatch(
      /recordHostedStart\(\s*undefined,\s*gameMode\(Boolean\(room\)\),\s*room \? buzzerPlayerCount \+ 1 : validPlayers\.length\s*\)/
    );
    expect(body.match(/\.\.\.recordHostedStart\(/g)).toHaveLength(3);
  });

  for (const page of ["app/game/page.tsx", "app/order/page.tsx"]) {
    it(`${page} sends the band and the score on the end and the leave`, () => {
      const body = code(read(page));
      expect(body).toMatch(/players: playerBand\(players\.length\),\s*scored: gameScored\(players\),/);
      expect(body).toMatch(/playerBand\(playersRef\.current\.length\),\s*gameScored\(playersRef\.current\)\s*\)/);
      expect(body).toMatch(/playersRef\.current = players;/);
    });
  }
});

describe("the digest renders what the recorders write", () => {
  const script = read("scripts/loop-stats.mjs");

  it("claims every new prefix, so nothing falls into Other counters", () => {
    const rendered = script.match(/const RENDERED_PREFIXES = \[([^\]]*)\]/)?.[1] ?? "";
    for (const prefix of [
      "game_players:",
      "game_end_players:",
      "game_left_players:",
      "game_end_scored:",
      "game_left_scored:",
    ]) {
      expect(rendered, `${prefix} is not claimed`).toContain(`"${prefix}"`);
    }
  });

  it("mirrors the bands the writer uses", () => {
    const bands = script.match(/const PLAYER_BAND_ORDER = \[([\s\S]*?)\];/)?.[1] ?? "";
    expect([...bands.matchAll(/\["([a-z0-9_]+)",/g)].map((m) => m[1])).toEqual([...PLAYER_BANDS]);
    for (const s of GAME_SCORED) expect(script).toContain(`["${s}",`);
  });
});
