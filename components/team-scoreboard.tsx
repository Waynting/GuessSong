"use client";

/**
 * The scoreboard and Game Over for a team game (lib/teams.ts), shared by
 * `/game` and `/order`.
 *
 * Markup only, on the two pages' own classes — `.score-row`, `.score-chip`,
 * `.winner-hero`, `.final-row` are drawn identically by both pages' `<style>`
 * blocks — plus the few `team-*` rules below. The host still awards a player;
 * every total here is summed from the player scores as it is drawn.
 *
 * The phone rule is the pages' own: the scoreboard is one sideways row of
 * chips, so a team is a chip with its total followed by its members' chips,
 * in the same strip — no second row, so Next Track stays on screen at
 * 390×844 (`tests/mobile.test.ts`). The breakpoint below must equal the
 * pages' `@media (max-width: 768px)`.
 */

import type { GamePlayer } from "@/lib/game-session";
import { TEAM_NAMES, teamLeader, teamMembers, teamOrder, teamTotals } from "@/lib/teams";

const TEAM_STYLE = `
  .team-block { display: flex; flex-direction: column; padding: 4px 0 8px; }
  .team-block + .team-block { border-top: 1px solid #1e1e1e; }
  .team-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 20px 4px;
  }
  .team-name {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 22px;
    letter-spacing: 0.05em;
    color: #ddd;
  }
  .team-total {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 30px;
    line-height: 1;
    letter-spacing: 0.03em;
    color: #aaa;
  }
  .team-block.ahead .team-name, .team-block.ahead .team-total { color: #1DB954; }
  .team-block .score-row { padding-top: 6px; padding-bottom: 6px; }
  .team-block .player-name-score { font-size: 13px; }
  .team-block .score-chip { font-size: 17px; }
  .final-team-tag {
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: #777;
  }
  .winner-hero-vs { font-size: 13px; color: #1DB954; opacity: 0.75; margin-top: 2px; }
  @media (max-width: 768px) {
    .team-block {
      flex: 0 0 auto;
      flex-direction: row;
      align-items: center;
      gap: 6px;
      padding: 0;
      /* The strip snaps by proximity; without a snap point at the team's
         own chip, the nearest one was a member's and the strip opened
         scrolled past Team A. */
      scroll-snap-align: start;
    }
    .team-block .score-row { scroll-snap-align: none; }
    .team-block + .team-block { border-top: none; border-left: 1px solid #2a2a2a; padding-left: 6px; }
    .team-head {
      gap: 8px;
      padding: 6px 12px;
      border-radius: var(--radius);
      background: #1c1c1c;
      border: 1px solid #333;
    }
    .team-block.ahead .team-head { border-color: rgba(29,185,84,0.45); background: rgba(29,185,84,0.1); }
    .team-name { font-size: 16px; }
    .team-total { font-size: 20px; }
  }
`;

/** The scoreboard's list for a team game: each side's total, its members under it. */
export function TeamScoreList({ players, scorePulse }: { players: GamePlayer[]; scorePulse: string | null }) {
  const totals = teamTotals(players);
  const leader = teamLeader(players);
  return (
    <>
      <style>{TEAM_STYLE}</style>
      {teamOrder(players).map((side) => (
        <div key={side} className={`team-block${leader === side ? " ahead" : ""}`}>
          <div className="team-head">
            <span className="team-name">{TEAM_NAMES[side]}</span>
            <span className="team-total">{totals[side]}</span>
          </div>
          {teamMembers(players, side).map((p) => (
            <div key={p.name} className="score-row">
              <div className="score-row-left">
                <span className="player-name-score">{p.name}</span>
              </div>
              <span className={`score-chip${scorePulse === p.name ? " pulse" : ""}`}>{p.score}</span>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

/**
 * Game Over for a team game: the winning side in the hero card, or the tie,
 * then every player with their side. Shown whether or not anyone scored — a
 * 0–0 is a tie, and saying so beats an empty card.
 */
export function TeamGameOver({ players }: { players: GamePlayer[] }) {
  const totals = teamTotals(players);
  const leader = teamLeader(players);
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const [first, second] = teamOrder(players);
  return (
    <>
      <style>{TEAM_STYLE}</style>
      <div className="winner-hero">
        <span className="winner-trophy">{leader === "tie" ? "🤝" : "🏆"}</span>
        <span className="winner-hero-name">
          {leader === "tie" || leader === null ? "It's a tie" : `${TEAM_NAMES[leader]} wins`}
        </span>
        <div style={{ textAlign: "right" }}>
          <div className="winner-hero-score">{totals[first]}</div>
          <div className="winner-hero-vs">
            {leader === "tie" || leader === null ? "pts each" : `vs ${TEAM_NAMES[second]} ${totals[second]}`}
          </div>
        </div>
      </div>
      <div className="final-scoreboard">
        {sorted.map((p, idx) => (
          <div key={p.name} className="final-row">
            <span className={`final-rank ${idx === 0 ? "first" : idx === 1 ? "second" : idx === 2 ? "third" : "rest"}`}>{idx + 1}</span>
            <span className="final-name">{p.name}</span>
            <span className="final-team-tag">{p.team ? TEAM_NAMES[p.team] : ""}</span>
            <span className={`final-score${idx <= 2 ? " podium" : ""}`}>{p.score}</span>
          </div>
        ))}
      </div>
    </>
  );
}
