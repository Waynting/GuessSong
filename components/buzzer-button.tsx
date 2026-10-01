"use client";

/**
 * The whole player-facing surface of Buzzer Mode: one button that fills the
 * phone.
 *
 * Three deliberate choices, all of them about the ~100ms around the press:
 *
 * 1. `onPointerDown`, not `onClick`. A click waits for pointerup, which on
 *    mobile can add 50-100ms of pure loss. Nobody is going to accept losing a
 *    round to their browser's event model.
 * 2. The pressed state flips locally before the network hears about it, so the
 *    thumb gets feedback at the speed of the screen rather than the speed of
 *    Wi-Fi. This is honest, not a lie: it says "sent", not "you won".
 * 3. Who actually won is only ever rendered from server state. Optimism covers
 *    the send, never the verdict.
 */

import { useState } from "react";
import type { BuzzerPhase, BuzzEntry } from "@/lib/buzzer-protocol";
import { buzzerRoundKey, describeBuzzer } from "@/lib/buzzer-round";

export interface BuzzerButtonProps {
  phase: BuzzerPhase;
  buzzes: BuzzEntry[];
  /** The snapshot's round identity, which the local latch is scoped to. */
  roundIndex: number | null;
  roundOpenedAt: number | null;
  playerId: string;
  connected: boolean;
  onBuzz: () => void;
}

export function BuzzerButton({
  phase,
  buzzes,
  roundIndex,
  roundOpenedAt,
  playerId,
  connected,
  onBuzz,
}: BuzzerButtonProps) {
  // Local half of the two-layer debounce. The room dedupes by playerId too, but
  // this is what stops a mobile long-press from firing a burst of frames in the
  // first place. It holds the round it was pressed in, not a boolean, so a new
  // round clears it whatever shape that round's first snapshot has — see
  // `buzzerRoundKey` in lib/buzzer-round.ts.
  const round = buzzerRoundKey(roundIndex === null ? null : { roundIndex, roundOpenedAt });
  const [pressedIn, setPressedIn] = useState<string | null>(null);
  const pressed = pressedIn === round;

  const myBuzz = buzzes.find((b) => b.playerId === playerId);
  const winner = buzzes[0];
  const iWon = winner?.playerId === playerId;

  const canBuzz = connected && !myBuzz && !pressed && phase !== "idle";

  function handlePointerDown() {
    if (!canBuzz) return;
    setPressedIn(round);
    // Haptics land before the round-trip; on a phone in a loud room this is the
    // only feedback the player reliably notices.
    navigator.vibrate?.(30);
    onBuzz();
  }

  const visual = describeBuzzer({ connected, phase, myBuzz, iWon, winner, pressed });

  return (
    <div className="flex flex-1 flex-col">
      <button
        type="button"
        onPointerDown={handlePointerDown}
        onContextMenu={(e) => e.preventDefault()}
        disabled={visual.disabled}
        aria-live="polite"
        className="flex flex-1 select-none flex-col items-center justify-center rounded-3xl text-center transition-transform duration-75 active:scale-[0.98] disabled:active:scale-100"
        style={{
          background: visual.bg,
          color: visual.fg,
          // Stops the long-press callout and double-tap zoom from stealing the
          // gesture on iOS, which otherwise eats the second buzz of a round.
          WebkitTouchCallout: "none",
          WebkitUserSelect: "none",
          touchAction: "manipulation",
        }}
      >
        <span className="px-6 text-5xl font-bold leading-tight tracking-tight">{visual.label}</span>
        {visual.sub && <span className="mt-3 px-6 text-base opacity-80">{visual.sub}</span>}
      </button>
    </div>
  );
}
