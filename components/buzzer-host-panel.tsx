"use client";

/**
 * Host side of Buzzer Mode, dropped into the game page.
 *
 * The host still judges — the room decides *who* pressed first, never *whether*
 * the answer was right. That split is what keeps the game feeling like a party
 * and not a quiz app: the server settles the argument nobody can settle by eye,
 * and a human settles the one no machine should.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useBuzzerSocket } from "@/lib/use-buzzer-socket";
import { buzzerJoinUrl } from "@/lib/buzzer-client";
import { trackEvent } from "@/lib/analytics";
import type { ServerMessage } from "@/lib/buzzer-protocol";

export interface BuzzerHostPanelProps {
  roomCode: string;
  hostToken: string;
  /** 0-based index of the song being played, from the game page. */
  roundIndex: number;
  /** The game page's own phase. Buzzing opens when the clip starts. */
  gamePhase: string;
  /** Called with the winning player's name when the host marks them correct. */
  onCorrect: (playerName: string) => void;
  /** Peak concurrent phones, reported upward so game_finished can carry it. */
  onPeakPlayers?: (peak: number) => void;
}

export function BuzzerHostPanel({
  roomCode,
  hostToken,
  roundIndex,
  gamePhase,
  onCorrect,
  onPeakPlayers,
}: BuzzerHostPanelProps) {
  const [qr, setQr] = useState<string | null>(null);
  const joinUrl = buzzerJoinUrl(roomCode);

  // Round bookkeeping for the analytics instrument. Refs, not state: these feed
  // events, never the render, so re-rendering on every buzz would be waste.
  const buzzCountRef = useRef(0);
  const peakRef = useRef(0);

  const handleServerMessage = useCallback(
    (msg: ServerMessage) => {
      if (msg.type === "buzz") {
        buzzCountRef.current += 1;
        trackEvent("buzz_received", {
          round_index: roundIndex + 1,
          buzz_order: msg.entry.order,
          ms_since_round_open: msg.entry.msSinceOpen,
        });
      }
      if (msg.type === "state" || msg.type === "players") {
        const count =
          msg.type === "state" ? msg.snapshot.players.length : msg.players.length;
        if (count > peakRef.current) {
          peakRef.current = count;
          onPeakPlayers?.(count);
        }
      }
    },
    [roundIndex, onPeakPlayers]
  );

  const { snapshot, connected, hostOpen, hostVerdict, hostReveal, hostNext } = useBuzzerSocket({
    code: roomCode,
    name: "Host",
    hostToken,
    onServerMessage: handleServerMessage,
  });

  useEffect(() => {
    QRCode.toDataURL(joinUrl, { margin: 1, width: 220 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [joinUrl]);

  // Buzzing opens the moment the clip starts, not when it finishes — half the
  // fun is someone getting it from two notes.
  const openedForRound = useRef<number | null>(null);
  useEffect(() => {
    if (gamePhase !== "playing") return;
    if (openedForRound.current === roundIndex) return;
    openedForRound.current = roundIndex;
    buzzCountRef.current = 0;
    hostOpen();
  }, [gamePhase, roundIndex, hostOpen]);

  const buzzes = snapshot?.buzzes ?? [];
  const current = buzzes[0];

  function resolve(verdict: "correct" | "wrong" | "revealed") {
    trackEvent("buzz_round_resolved", {
      round_index: roundIndex + 1,
      verdict,
      buzz_count: buzzCountRef.current,
    });
    if (verdict === "revealed") return hostReveal();
    if (verdict === "correct" && current) onCorrect(current.name);
    hostVerdict(verdict);
  }

  const players = snapshot?.players ?? [];

  return (
    <div className="rounded-2xl bg-[#1a1a1a] p-4 text-white">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-[#888]">房間碼</p>
          <p className="text-4xl font-bold tracking-[0.2em] text-[#1DB954]">{roomCode}</p>
          <p className="mt-1 text-xs text-[#888]">
            {connected ? `${players.filter((p) => p.connected).length} / ${players.length} 支手機在線` : "連線中…"}
          </p>
        </div>
        {qr && (
          // eslint-disable-next-line @next/next/no-img-element -- data: URI generated client-side, nothing for next/image to optimise
          <img src={qr} alt={`加入 ${roomCode} 的 QR code`} className="h-28 w-28 rounded bg-white p-1" />
        )}
      </div>

      <div className="mt-4 min-h-[4.5rem] rounded-xl bg-[#111] p-3">
        {current ? (
          <>
            <p className="text-2xl font-bold text-[#1DB954]">{current.name}</p>
            <p className="text-xs text-[#888]">
              {(current.msSinceOpen / 1000).toFixed(2)} 秒
              {buzzes.length > 1 && ` · 後面還有 ${buzzes.length - 1} 人`}
            </p>
          </>
        ) : (
          <p className="text-sm text-[#666]">
            {snapshot?.phase === "open" ? "開放搶答中 — 還沒有人按" : "等下一首"}
          </p>
        )}
      </div>

      {buzzes.length > 1 && (
        <ol className="mt-2 flex flex-wrap gap-2 text-xs text-[#888]">
          {buzzes.slice(1).map((b) => (
            <li key={b.playerId} className="rounded bg-[#222] px-2 py-1">
              {b.order}. {b.name}
            </li>
          ))}
        </ol>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => resolve("correct")}
          disabled={!current}
          className="rounded-lg bg-[#1DB954] py-3 font-semibold text-[#04120a] disabled:opacity-30"
        >
          答對
        </button>
        <button
          type="button"
          onClick={() => resolve("wrong")}
          disabled={!current}
          className="rounded-lg bg-[#3a1a1a] py-3 font-semibold text-[#ff6b6b] disabled:opacity-30"
        >
          答錯
        </button>
        <button
          type="button"
          onClick={() => resolve("revealed")}
          className="rounded-lg bg-[#222] py-3 font-semibold text-[#bbb]"
        >
          公布答案
        </button>
      </div>

      <button
        type="button"
        onClick={hostNext}
        className="mt-2 w-full rounded-lg bg-[#181818] py-2 text-sm text-[#888]"
      >
        下一首(重置搶答)
      </button>

      <p className="mt-3 break-all text-center text-[10px] text-[#555]">{joinUrl}</p>
    </div>
  );
}
