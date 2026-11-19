import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TEAM_MIN_PLAYERS,
  TEAM_NAMES,
  alternateTeams,
  dealTeams,
  fitTeams,
  hasTeams,
  isTeamSide,
  normalizeTeams,
  removeTeamAt,
  rosterWithTeams,
  swapTeam,
  teamLeader,
  teamMembers,
  teamOrder,
  teamTotals,
  teamsOffered,
} from "@/lib/teams";
import { parseGamePayload } from "@/lib/game-session";
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

const { recordGameStart, recordGameEnd, teamsFitBand, loopStatsKeys, __resetLivenessForTests } = await import(
  "@/lib/loop-stats"
);

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

beforeEach(() => {
  kv.incrs = [];
  __resetLivenessForTests();
});

const metrics = () =>
  kv.incrs.filter((k) => !k.endsWith(":live")).map((k) => k.replace("loop:stats:2026-11-17:", ""));

const TRACK = { id: "t1", name: "Song", artists: ["A"], durationMs: 1, createdAt: "" };
const payload = (players: unknown) => JSON.stringify({ tracks: [TRACK], players });

describe("assignment: alternate, swap, keep aligned with the rows", () => {
  it("is offered from four typed names", () => {
    expect(TEAM_MIN_PLAYERS).toBe(4);
    expect(teamsOffered(3)).toBe(false);
    expect(teamsOffered(4)).toBe(true);
    expect(teamsOffered(9)).toBe(true);
    expect(teamsOffered(Number.NaN)).toBe(false);
  });

  it("alternates A, B, A, B", () => {
    expect(alternateTeams(5)).toEqual(["a", "b", "a", "b", "a"]);
    expect(alternateTeams(-1)).toEqual([]);
  });

  it("deals over the typed names, a blank row taking the smaller side", () => {
    expect(dealTeams(["Amy", "Ben", "Cat", "Dan"])).toEqual(["a", "b", "a", "b"]);
    expect(dealTeams(["Amy", "", "Ben", "Cat", "Dan"])).toEqual(["a", "b", "b", "a", "b"]);
    const live = rosterWithTeams(["Amy", "", "Ben", "Cat", "Dan"], dealTeams(["Amy", "", "Ben", "Cat", "Dan"]));
    expect(live.filter((p) => p.team === "a")).toHaveLength(2);
    expect(live.filter((p) => p.team === "b")).toHaveLength(2);
  });

  it("swaps one row and leaves the rest", () => {
    expect(swapTeam(["a", "b", "a", "b"], 2)).toEqual(["a", "b", "b", "b"]);
    expect(swapTeam(["a", "b"], 9)).toEqual(["a", "b"]);
  });

  it("grows onto the smaller side and shrinks from the end", () => {
    expect(fitTeams(["a", "a", "b"], 5)).toEqual(["a", "a", "b", "b", "a"]);
    expect(fitTeams(["a", "b", "a"], 2)).toEqual(["a", "b"]);
    expect(fitTeams([], 3)).toEqual(["a", "b", "a"]);
  });

  it("removes a row's side with the row", () => {
    expect(removeTeamAt(["a", "b", "b", "a"], 1)).toEqual(["a", "b", "a"]);
  });

  it("drops blank rows and trims names on the way to the payload", () => {
    expect(rosterWithTeams([" Amy ", "", "Ben"], ["b", "a", "a"])).toEqual([
      { name: "Amy", team: "b" },
      { name: "Ben", team: "a" },
    ]);
  });
});

describe("payload repair: never refused, played without teams when they do not hold", () => {
  it("reads an old payload with no teams exactly as before", () => {
    const parsed = parseGamePayload(payload([{ name: "Amy", score: 3 }, { name: "Ben", score: 0 }]));
    expect(parsed?.players).toEqual([{ name: "Amy", score: 3 }, { name: "Ben", score: 0 }]);
    expect(parsed?.players.every((p) => !("team" in p))).toBe(true);
  });

  it("keeps a valid split", () => {
    const players = [
      { name: "Amy", score: 1, team: "a" },
      { name: "Ben", score: 2, team: "b" },
      { name: "Cat", score: 3, team: "a" },
      { name: "Dan", score: 4, team: "b" },
    ];
    expect(parseGamePayload(payload(players))?.players).toEqual(players);
  });

  it("treats junk sides as no side, and a teamless player joins the smaller team", () => {
    const parsed = parseGamePayload(
      payload([
        { name: "Amy", score: 0, team: "a" },
        { name: "Ben", score: 0, team: "b" },
        { name: "Cat", score: 0, team: "a" },
        { name: "Dan", score: 0, team: "b" },
        { name: "Eve", score: 0, team: "c" },
        { name: "Fay", score: 0, team: 7 },
      ])
    );
    expect(parsed?.players.map((p) => p.team)).toEqual(["a", "b", "a", "b", "a", "b"]);
    expect(isTeamSide("c")).toBe(false);
  });

  it("drops teams when only one team is present", () => {
    const parsed = parseGamePayload(
      payload([
        { name: "Amy", score: 0, team: "a" },
        { name: "Ben", score: 0, team: "a" },
        { name: "Cat", score: 0, team: "a" },
        { name: "Dan", score: 0, team: "a" },
      ])
    );
    expect(parsed?.players).toHaveLength(4);
    expect(hasTeams(parsed!.players)).toBe(false);
  });

  it("drops teams when a side has fewer than two", () => {
    const parsed = parseGamePayload(
      payload([
        { name: "Amy", score: 0, team: "a" },
        { name: "Ben", score: 0, team: "a" },
        { name: "Cat", score: 0, team: "a" },
        { name: "Dan", score: 0, team: "b" },
      ])
    );
    expect(hasTeams(parsed!.players)).toBe(false);
    expect(parsed?.players.every((p) => !("team" in p))).toBe(true);
  });

  it("normalizeTeams is the same rule the setup page runs", () => {
    expect(hasTeams(normalizeTeams([{ team: "a" }, { team: "b" }, { team: "a" }]))).toBe(false);
    expect(hasTeams(normalizeTeams([{ team: "a" }, { team: "b" }, { team: "a" }, { team: "b" }]))).toBe(true);
  });
});

describe("totals and the winner", () => {
  const room = [
    { name: "Amy", score: 3, team: "a" as const },
    { name: "Ben", score: 4, team: "b" as const },
    { name: "Cat", score: 1, team: "a" as const },
    { name: "Dan", score: 1, team: "b" as const },
  ];

  it("sums each side from the player scores", () => {
    expect(teamTotals(room)).toEqual({ a: 4, b: 5 });
    expect(teamLeader(room)).toBe("b");
    expect(teamOrder(room)).toEqual(["b", "a"]);
    expect(teamMembers(room, "b").map((p) => p.name)).toEqual(["Ben", "Dan"]);
  });

  it("calls a level game a tie, 0–0 included, and A first on a tie", () => {
    const level = room.map((p) => (p.name === "Cat" ? { ...p, score: 2 } : p));
    expect(teamLeader(level)).toBe("tie");
    expect(teamOrder(level)).toEqual(["a", "b"]);
    expect(teamLeader(room.map((p) => ({ ...p, score: 0 })))).toBe("tie");
  });

  it("is null for a game without teams", () => {
    expect(teamLeader([{ score: 3 }])).toBeNull();
    expect(TEAM_NAMES).toEqual({ a: "Team A", b: "Team B" });
  });
});

describe("counting: game_teams:on and game_end_teams:<end>, closed sets", () => {
  it("parses only a literal true, on the start and the end", () => {
    expect(parsePulse({ kind: "game_started", hostGameIndex: 1, teams: true })).toEqual({
      kind: "game_started",
      hostGameIndex: 1,
      teams: true,
    });
    for (const junk of ["true", 1, false, null, {}]) {
      expect(parsePulse({ kind: "game_started", hostGameIndex: 1, teams: junk })).toEqual({
        kind: "game_started",
        hostGameIndex: 1,
      });
      expect(parsePulse({ kind: "game_finished", end: "played_out", roundsPlayed: 3, teams: junk })).toEqual({
        kind: "game_finished",
        end: "played_out",
        roundsPlayed: 3,
      });
    }
    expect(parsePulse({ kind: "game_finished", end: "ended_early", roundsPlayed: 2, teams: true })).toMatchObject({
      teams: true,
    });
  });

  it("records the start only for a band teams can be offered in", async () => {
    expect(teamsFitBand("p3_4")).toBe(true);
    expect(teamsFitBand("p5_plus")).toBe(true);
    expect(teamsFitBand("p2")).toBe(false);
    expect(teamsFitBand(undefined)).toBe(false);
    await recordGameStart(1, { players: "p5_plus", teams: true });
    expect(metrics()).toContain("game_teams:on");
    kv.incrs = [];
    await recordGameStart(1, { players: "p2", teams: true });
    await recordGameStart(1, { players: "p5_plus" });
    expect(metrics()).not.toContain("game_teams:on");
  });

  it("records the end by GAME_ENDS, and nothing for a non-team or junk end", async () => {
    await recordGameEnd("played_out", 10, { players: "p3_4", teams: true });
    await recordGameEnd("ended_early", 2, { players: "p5_plus", teams: true });
    expect(metrics()).toEqual(expect.arrayContaining(["game_end_teams:played_out", "game_end_teams:ended_early"]));
    kv.incrs = [];
    await recordGameEnd("played_out", 10, { players: "p5_plus" });
    await recordGameEnd("played_out", 10, { players: "p1", teams: true });
    await recordGameEnd("nope" as "played_out", 10, { players: "p5_plus", teams: true });
    expect(metrics().filter((k) => k.startsWith("game_end_teams:"))).toEqual([]);
  });

  it("names the keys the stats script reads", () => {
    const keys = loopStatsKeys("2026-11-17", []);
    expect(keys.gameTeams).toBe("loop:stats:2026-11-17:game_teams:on");
    expect(Object.keys(keys.gameEndTeams)).toEqual(["played_out", "ended_early"]);
    const script = read("scripts/loop-stats.mjs");
    expect(script).toMatch(/Team games/);
    expect(script).toMatch(/get\("game_teams:on"\)/);
    expect(script).toMatch(/game_end_teams:played_out/);
    expect(script).toMatch(/game_players:p5_plus/);
    expect(script).toMatch(/"game_teams:",\s*"game_end_teams:",/);
  });
});

describe("page wiring", () => {
  it("the setup page offers the switch from four names and stores sides on the roster", () => {
    const page = read("app/setup-page.tsx");
    // The words live in lib/setup-copy.ts since the Portuguese page.
    expect(page).toMatch(/\{copy\.teams\.toggle\}/);
    expect(read("lib/setup-copy.ts")).toMatch(/toggle: "Split into two teams"/);
    expect(page).toMatch(/teamsVisible = teamsOffered\(typedPlayerCount\)/);
    expect(page).toMatch(/teamsOn && teamsVisible && setupMode === "single" && !buzzerEnabled && who !== "solo"/);
    expect(page).toMatch(/normalizeTeams\(rosterWithTeams\(roster, rowTeams\)/);
    expect(page).toMatch(/players: room \? \[\] : rosterPlayers/);
    expect(page).toMatch(/\.\.\.\(teams \? \{ teams: true \} : \{\}\)/);
    expect(page).toMatch(/swapPlayerTeam\(idx\)/);
    // A lopsided split is played without teams, so the switch says so first.
    expect(page).toMatch(/teamsHold \? copy\.teams\.on : copy\.teams\.needTwo/);
    expect(read("lib/setup-copy.ts")).toMatch(/needTwo: "2 a side needed"/);
  });

  it.each(["app/game/page.tsx", "app/order/page.tsx"])("%s draws team totals and sends the flag on the end", (file) => {
    const page = read(file);
    expect(page).toMatch(/const teamGame = hasTeams\(players\)/);
    // The order page passes its payload's language (lib/order-copy.ts); /game is English.
    expect(page).toMatch(/<TeamScoreList players=\{players\} scorePulse=\{scorePulse\}(?: locale=\{pageLocale\})? \/>/);
    expect(page).toMatch(/<TeamGameOver players=\{players\}(?: locale=\{pageLocale\})? \/>/);
    expect(page).toMatch(/\.\.\.\(hasTeams\(players\) \? \{ teams: true \} : \{\}\)/);
  });

  it("the team scoreboard keeps the phone strip to one row at the pages' breakpoint", () => {
    const board = read("components/team-scoreboard.tsx");
    expect(board).toMatch(/@media \(max-width: 768px\)/);
    expect(board).toMatch(/\.team-block \{\s*flex: 0 0 auto;\s*flex-direction: row;/);
    expect(board).toMatch(/teamTotals\(players\)/);
  });
});
