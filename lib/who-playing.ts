/**
 * "Who's playing?" — the first question on `/`, and the one way the setup
 * card picks between the three games a host can start from it.
 *
 * It replaced three controls that each did a third of this: the "How to
 * play" pill row, a Mixed header reached from a text link under Start, and
 * the solo nudge under the roster. 68% of games in the week to 2026-10-26 had
 * one player and played out at 13.6% on the guess game against 30.4% on the
 * order game, and the order game was a pill most of them never read. Asking
 * the room's size first sends a visitor alone to the game that scores itself
 * without making them find it.
 *
 * The answer is not stored. It is derived from the form a restore puts on
 * screen (`whoFromSetup`), so a remembered setup, `?mode=mixed` and "Start
 * fresh" all land on the right row with no new field in lib/setup-memory.ts
 * and nothing to migrate. In `lib/` rather than `app/page.tsx` because the
 * suite reaches only `lib/`.
 */

import type { PlayStyle } from "@/lib/order-game";
import type { SetupMode } from "@/lib/start-status";

export type WhoPlaying = "solo" | "group" | "mixed";

export const WHO_PLAYING: readonly WhoPlaying[] = ["solo", "group", "mixed"];

/**
 * The name a solo game is scored under when the host typed none. The order
 * game keeps a scoreboard by name, and "Just me" asks for no name at all —
 * asking a person alone to type their own name to play is a field between
 * them and the first round.
 */
export const SOLO_DEFAULT_NAME = "You";

/**
 * Which row a form reads as. Mixed is Mixed; the order game with at most one
 * name is someone alone; everything else is a group, including an order game
 * with a roster — the room picked order from the settings, and it is still a
 * room.
 */
export function whoFromSetup(form: {
  setupMode: SetupMode;
  playStyle: PlayStyle;
  players: readonly string[];
}): WhoPlaying {
  if (form.setupMode === "mixed") return "mixed";
  const named = form.players.filter((p) => p.trim()).length;
  if (form.playStyle === "order" && named <= 1) return "solo";
  return "group";
}

/**
 * What tapping a row changes. `playStyle` is absent when the row leaves it
 * alone: Mixed plays either game, and a group keeps the game it had — except
 * a group arriving from "Just me", which was the order game only because the
 * row chose it, so it goes back to the default.
 */
export function setupForWho(
  next: WhoPlaying,
  previous: WhoPlaying
): { setupMode: SetupMode; playStyle?: PlayStyle } {
  if (next === "solo") return { setupMode: "single", playStyle: "order" };
  if (next === "mixed") return { setupMode: "mixed" };
  return previous === "solo" ? { setupMode: "single", playStyle: "guess" } : { setupMode: "single" };
}

/**
 * The roster a solo game starts with: the first name the form still holds
 * (a host who typed one before picking "Just me" keeps it), else
 * `SOLO_DEFAULT_NAME`. Always exactly one, so the order game's scoreboard has
 * its one row and `players_required` cannot fire on a form that shows no
 * roster to fix.
 */
export function soloRoster(players: readonly string[]): string[] {
  const named = players.map((p) => p.trim()).find((p) => p.length > 0);
  return [named ?? SOLO_DEFAULT_NAME];
}
