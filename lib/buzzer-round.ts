/**
 * Round rules for Buzzer Mode's two screens, kept in `lib/` because the suite
 * reaches `lib/` and cannot import the `.tsx` components that apply them.
 */

import type { BuzzerPhase, BuzzEntry, RoomSnapshot } from "@/lib/buzzer-protocol";

/**
 * Which round a buzz belongs to, as the phone can tell it. A new round from
 * `host:next` bumps `roundIndex`; a round reopened for everyone (a wrong
 * answer with nobody else queued) gets a new `roundOpenedAt`.
 *
 * The player's local "pressed" latch is scoped to this key. It used to clear
 * only on a render that saw exactly `phase === "open"` with an empty queue —
 * a phone that locked its screen across `round:open` came back to a snapshot
 * already `locked` with someone at the head, never saw that shape, and kept
 * the latch for the rest of the game: taps did nothing.
 */
export function buzzerRoundKey(
  snapshot: Pick<RoomSnapshot, "roundIndex" | "roundOpenedAt"> | null
): string {
  return snapshot ? `${snapshot.roundIndex}:${snapshot.roundOpenedAt ?? "-"}` : "";
}

export type BuzzerVisual = {
  label: string;
  sub?: string;
  bg: string;
  fg: string;
  disabled: boolean;
};

/**
 * What the player's button says. `pressed` is checked before "someone else
 * buzzed first": a player whose own buzz is still on its way cannot queue
 * again, so the button must not say they can.
 */
export function describeBuzzer(s: {
  connected: boolean;
  phase: BuzzerPhase;
  myBuzz: BuzzEntry | undefined;
  iWon: boolean;
  winner: BuzzEntry | undefined;
  pressed: boolean;
}): BuzzerVisual {
  if (!s.connected) {
    return { label: "Connecting…", sub: "Come back to this screen and it reconnects", bg: "#1a1a1a", fg: "#888", disabled: true };
  }
  if (s.iWon) {
    return { label: "You buzzed first", sub: "Shout the answer", bg: "#1DB954", fg: "#04120a", disabled: true };
  }
  if (s.myBuzz) {
    // Queued behind the winner. Worth showing the position, because a wrong
    // answer passes the question down the line and they may still be up.
    return {
      label: `#${s.myBuzz.order} in line`,
      sub: s.winner ? `${s.winner.name} was first — you are up if they miss` : undefined,
      bg: "#1a2a1a",
      fg: "#8fd6a5",
      disabled: true,
    };
  }
  if (s.pressed) {
    return { label: "Sent…", bg: "#1a2a1a", fg: "#8fd6a5", disabled: true };
  }
  if (s.winner) {
    // The queue outlives the round (see `reduce`), so between rounds the
    // winner is still worth naming — but nobody can queue behind them then.
    return s.phase === "idle"
      ? { label: `${s.winner.name}`, sub: "buzzed first", bg: "#1a1a1a", fg: "#bbb", disabled: true }
      : { label: `${s.winner.name}`, sub: "buzzed first — you can still queue", bg: "#1a1a1a", fg: "#bbb", disabled: false };
  }
  if (s.phase === "idle") {
    return { label: "Wait for the clip", bg: "#141414", fg: "#666", disabled: true };
  }
  return { label: "BUZZ", bg: "#1DB954", fg: "#04120a", disabled: false };
}
