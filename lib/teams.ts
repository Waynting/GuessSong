/**
 * Two teams for a big room.
 *
 * Rooms of five or more play out about twice as often as one player does, so
 * the big room is the audience worth making easier to run. With teams on the
 * host still awards a *player* — the award buttons stay per name, the host is
 * the judge — and the scoreboard adds each team's members up. Nothing about
 * scoring changes: a team total is derived from the player scores every time
 * it is drawn, never stored, so a buzzer award by name, a roster merge or a
 * reload cannot leave the two out of step.
 *
 * In a module with no imports, for the reason `lib/game-players.ts` gives:
 * the setup page, both game pages, `lib/game-session.ts`, `lib/pulse.ts` and
 * `lib/loop-stats.ts` all read it, and the last imports the KV client.
 */

export type TeamSide = "a" | "b";

export const TEAM_SIDES: readonly TeamSide[] = ["a", "b"];

/** What the scoreboard calls each side. Not editable: a name field per team was one more row on a 390px setup page. */
export const TEAM_NAMES: Record<TeamSide, string> = { a: "Team A", b: "Team B" };

/** The setup page offers the split from this many typed names. */
export const TEAM_MIN_PLAYERS = 4;

/** A side with fewer than this is not a team, and the game is played without teams. */
export const TEAM_MIN_PER_SIDE = 2;

export function isTeamSide(value: unknown): value is TeamSide {
  return typeof value === "string" && (TEAM_SIDES as readonly string[]).includes(value);
}

export function otherSide(side: TeamSide): TeamSide {
  return side === "a" ? "b" : "a";
}

/** Whether the setup page shows "Split into two teams" for this many typed names. */
export function teamsOffered(typedNames: number): boolean {
  return Number.isFinite(typedNames) && typedNames >= TEAM_MIN_PLAYERS;
}

/** A, B, A, B… — what turning the toggle on deals. */
export function alternateTeams(count: number): TeamSide[] {
  const n = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  return Array.from({ length: n }, (_, i) => (i % 2 === 0 ? "a" : "b"));
}

/**
 * What turning the toggle on deals over the roster rows: the typed names
 * alternate A, B, A, B in the order they were typed, and a blank row takes
 * the smaller side — so a blank between two names cannot put both on A.
 */
export function dealTeams(rows: readonly string[]): TeamSide[] {
  let typed = 0;
  const out: TeamSide[] = [];
  for (const row of rows) {
    if (row.trim()) {
      out.push(typed % 2 === 0 ? "a" : "b");
      typed += 1;
    } else {
      const a = out.filter((t) => t === "a").length;
      out.push(a <= out.length - a ? "a" : "b");
    }
  }
  return out;
}

/**
 * The side list resized to `count` rows: cut from the end, or grown by
 * putting each new row on the smaller side (A on a tie), which is what
 * alternation would have done for a list that was never swapped.
 */
export function fitTeams(teams: readonly TeamSide[], count: number): TeamSide[] {
  const n = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  const out = teams.slice(0, n);
  while (out.length < n) {
    const a = out.filter((t) => t === "a").length;
    out.push(a <= out.length - a ? "a" : "b");
  }
  return out;
}

/** Row `idx` moved to the other side. Out of range is a no-op. */
export function swapTeam(teams: readonly TeamSide[], idx: number): TeamSide[] {
  return teams.map((t, i) => (i === idx ? otherSide(t) : t));
}

/** Row `idx` removed, so the sides stay aligned with the roster rows. */
export function removeTeamAt(teams: readonly TeamSide[], idx: number): TeamSide[] {
  return teams.filter((_, i) => i !== idx);
}

/**
 * The typed names with their sides, blanks dropped — the roster rows and the
 * side list are parallel, and a blank row's side goes with it.
 */
export function rosterWithTeams(
  rows: readonly string[],
  teams: readonly TeamSide[]
): { name: string; team: TeamSide }[] {
  const out: { name: string; team: TeamSide }[] = [];
  const fitted = fitTeams(teams, rows.length);
  rows.forEach((raw, i) => {
    const name = raw.trim();
    if (name) out.push({ name, team: fitted[i] });
  });
  return out;
}

/**
 * Teams that a game can be played with, or none at all — the repair
 * `parseGamePayload` and the setup page's start both run.
 *
 * Repaired, never refused, for `parseGamePayload`'s reason: a payload in a
 * host's sessionStorage has to keep playing across a deploy.
 *
 * - A side that is not `a` or `b` is no side.
 * - Fewer than `TEAM_MIN_PER_SIDE` on either side (one team, or 3 against 1)
 *   is no teams: every `team` is stripped and the game is the ordinary one.
 * - Otherwise a player with no side joins the smaller team (A on a tie) — a
 *   name a buzzer room adds mid-game, or one row of junk, still counts.
 */
export function normalizeTeams<P extends { team?: unknown }>(players: readonly P[]): (Omit<P, "team"> & { team?: TeamSide })[] {
  const strip = (p: P): Omit<P, "team"> => {
    const rest = { ...p };
    delete rest.team;
    return rest;
  };
  const sides = players.map((p) => (isTeamSide(p.team) ? p.team : null));
  const counts = { a: 0, b: 0 };
  for (const s of sides) if (s) counts[s] += 1;
  if (counts.a < TEAM_MIN_PER_SIDE || counts.b < TEAM_MIN_PER_SIDE) return players.map(strip);
  return players.map((p, i) => {
    let side = sides[i];
    if (!side) {
      side = counts.a <= counts.b ? "a" : "b";
      counts[side] += 1;
    }
    return { ...strip(p), team: side };
  });
}

/** Whether a scoreboard is a team game. */
export function hasTeams(players: readonly { team?: unknown }[]): boolean {
  return players.some((p) => isTeamSide(p.team));
}

/** Each side's total — always summed from the player scores, never stored. */
export function teamTotals(players: readonly { score: number; team?: unknown }[]): Record<TeamSide, number> {
  const totals = { a: 0, b: 0 };
  for (const p of players) {
    if (isTeamSide(p.team) && Number.isFinite(p.score)) totals[p.team] += p.score;
  }
  return totals;
}

/** The side ahead, `tie` when level (0–0 included), or null for a game without teams. */
export function teamLeader(players: readonly { score: number; team?: unknown }[]): TeamSide | "tie" | null {
  if (!hasTeams(players)) return null;
  const { a, b } = teamTotals(players);
  if (a === b) return "tie";
  return a > b ? "a" : "b";
}

/** A side's members, highest score first — the scoreboard's order under the team row. */
export function teamMembers<P extends { score: number; team?: unknown }>(players: readonly P[], side: TeamSide): P[] {
  return players.filter((p) => p.team === side).sort((x, y) => y.score - x.score);
}

/** Sides in scoreboard order: the leader first, A first on a tie. */
export function teamOrder(players: readonly { score: number; team?: unknown }[]): TeamSide[] {
  return teamLeader(players) === "b" ? ["b", "a"] : ["a", "b"];
}
