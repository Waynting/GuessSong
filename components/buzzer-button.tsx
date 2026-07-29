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

import { useEffect, useState } from "react";
import type { BuzzerPhase, BuzzEntry } from "@/lib/buzzer-protocol";

export interface BuzzerButtonProps {
  phase: BuzzerPhase;
  buzzes: BuzzEntry[];
  playerId: string;
  /** Server clock, so it is compared against a server-derived remaining time. */
  penaltyUntil: number | null;
  connected: boolean;
  onBuzz: () => void;
}

type Visual = {
  label: string;
  sub?: string;
  bg: string;
  fg: string;
  disabled: boolean;
};

export function BuzzerButton({
  phase,
  buzzes,
  playerId,
  penaltyUntil,
  connected,
  onBuzz,
}: BuzzerButtonProps) {
  // Local half of the two-layer debounce. The room dedupes by playerId too, but
  // this is what stops a mobile long-press from firing a burst of frames in the
  // first place.
  const [pressed, setPressed] = useState(false);
  const [penaltyLeft, setPenaltyLeft] = useState(0);

  const myBuzz = buzzes.find((b) => b.playerId === playerId);
  const winner = buzzes[0];
  const iWon = winner?.playerId === playerId;

  // A new round clears the local latch. Without this the button stays dead
  // after the first song.
  useEffect(() => {
    if (phase === "open" && buzzes.length === 0) setPressed(false);
  }, [phase, buzzes.length]);

  useEffect(() => {
    if (!penaltyUntil) return setPenaltyLeft(0);
    const tick = () => setPenaltyLeft(Math.max(0, penaltyUntil - Date.now()));
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [penaltyUntil]);

  const penalised = penaltyLeft > 0;
  const canBuzz = connected && !penalised && !myBuzz && !pressed && phase !== "idle";

  function handlePointerDown() {
    if (!canBuzz) return;
    setPressed(true);
    // Haptics land before the round-trip; on a phone in a loud room this is the
    // only feedback the player reliably notices.
    navigator.vibrate?.(30);
    onBuzz();
  }

  const visual = describe({ connected, penalised, penaltyLeft, phase, myBuzz, iWon, winner, pressed });

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

function describe(s: {
  connected: boolean;
  penalised: boolean;
  penaltyLeft: number;
  phase: BuzzerPhase;
  myBuzz: BuzzEntry | undefined;
  iWon: boolean;
  winner: BuzzEntry | undefined;
  pressed: boolean;
}): Visual {
  if (!s.connected) {
    return { label: "連線中…", sub: "回到這個畫面就會自動接回", bg: "#1a1a1a", fg: "#888", disabled: true };
  }
  if (s.penalised) {
    return {
      label: "搶快了",
      sub: `${(s.penaltyLeft / 1000).toFixed(1)} 秒後可以再搶`,
      bg: "#3a1a1a",
      fg: "#ff6b6b",
      disabled: true,
    };
  }
  if (s.iWon) {
    return { label: "你搶到了", sub: "大聲講答案", bg: "#1DB954", fg: "#04120a", disabled: true };
  }
  if (s.myBuzz) {
    // Queued behind the winner. Worth showing the position, because a wrong
    // answer passes the question down the line and they may still be up.
    return {
      label: `第 ${s.myBuzz.order} 個`,
      sub: s.winner ? `${s.winner.name} 先搶到,答錯就換你` : undefined,
      bg: "#1a2a1a",
      fg: "#8fd6a5",
      disabled: true,
    };
  }
  if (s.winner) {
    return { label: `${s.winner.name}`, sub: "先搶到了 — 還能排隊", bg: "#1a1a1a", fg: "#bbb", disabled: false };
  }
  if (s.pressed) {
    return { label: "已送出…", bg: "#1a2a1a", fg: "#8fd6a5", disabled: true };
  }
  if (s.phase === "idle") {
    return { label: "等主持人放歌", bg: "#141414", fg: "#666", disabled: true };
  }
  return { label: "搶答", bg: "#1DB954", fg: "#04120a", disabled: false };
}
