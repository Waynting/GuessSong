"use client";

/**
 * Host side of Buzzer Mode, embedded in the game page.
 *
 * The room decides *who* pressed first; a human decides *whether* the answer was
 * right. That split is what keeps this a party game rather than a quiz app: the
 * server settles the argument nobody can settle by eye, and a person settles the
 * one no machine should.
 *
 * This panel deliberately owns no Reveal and no Next. Those already exist on the
 * game page, and having two of each meant the host had to know which one also
 * talked to the room. The game page drives both and calls in here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { useBuzzerSocket } from "@/lib/use-buzzer-socket";
import { buzzerJoinUrl } from "@/lib/buzzer-client";
import { trackEvent } from "@/lib/analytics";
import type { BuzzEntry, ServerMessage } from "@/lib/buzzer-protocol";

export interface BuzzerHostPanelProps {
  roomCode: string;
  hostToken: string;
  /** What the host is called in the room, so they can buzz and be scored. */
  hostName: string;
  /** 0-based index of the song being played, from the game page. */
  roundIndex: number;
  /** The game page's own phase. Buzzing opens when the clip starts. */
  gamePhase: string;
  /** Everyone in the room, so the scoreboard can be driven by who actually joined. */
  onPlayersChange?: (names: string[]) => void;
  /** Peak concurrent phones, reported upward so game_finished can carry it. */
  onPeakPlayers?: (peak: number) => void;
  /**
   * Handed the room's controls so the game page's existing Reveal / Next /
   * scoring buttons can drive the room instead of duplicating it.
   */
  onControls?: (controls: BuzzerControls) => void;
}

export interface BuzzerControls {
  buzzes: BuzzEntry[];
  /** Award the current buzzer and end the round. */
  correct: () => void;
  /** Pass the question to whoever is next in the queue. */
  wrong: () => void;
  /** Give up on the round; nobody scores. */
  reveal: () => void;
  /** Clear the queue for the next clip. */
  next: () => void;
}

export function BuzzerHostPanel({
  roomCode,
  hostToken,
  hostName,
  roundIndex,
  gamePhase,
  onPlayersChange,
  onPeakPlayers,
  onControls,
}: BuzzerHostPanelProps) {
  const [qr, setQr] = useState<string | null>(null);
  const [showJoin, setShowJoin] = useState(true);
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
        const list = msg.type === "state" ? msg.snapshot.players : msg.players;
        onPlayersChange?.(list.map((p) => p.name));
        if (list.length > peakRef.current) {
          peakRef.current = list.length;
          onPeakPlayers?.(list.length);
        }
      }
    },
    [roundIndex, onPlayersChange, onPeakPlayers]
  );

  const { snapshot, connected, buzz, hostOpen, hostVerdict, hostReveal, hostNext } =
    useBuzzerSocket({
      code: roomCode,
      name: hostName,
      hostToken,
      onServerMessage: handleServerMessage,
    });

  useEffect(() => {
    QRCode.toDataURL(joinUrl, { margin: 1, width: 220 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [joinUrl]);

  // Buzzing opens the moment the clip starts, not when it finishes — half the
  // fun is someone getting it from two notes. Also collapses the join panel, so
  // the queue gets the screen once the game is actually running.
  const openedForRound = useRef<number | null>(null);
  useEffect(() => {
    if (gamePhase !== "playing") return;
    if (openedForRound.current === roundIndex) return;
    openedForRound.current = roundIndex;
    buzzCountRef.current = 0;
    setShowJoin(false);
    hostOpen();
  }, [gamePhase, roundIndex, hostOpen]);

  // useMemo, not `snapshot?.buzzes ?? []`: that fallback minted a fresh array
  // on every render while the socket was still connecting, which re-fired the
  // onControls effect, which set new controls on the parent, which re-rendered
  // this — an infinite loop in exactly the first second of every buzzer game.
  const buzzes = useMemo(() => snapshot?.buzzes ?? [], [snapshot?.buzzes]);
  const current = buzzes[0];
  const phase = snapshot?.phase ?? "idle";
  const hostBuzzed = buzzes.some((b) => b.name === hostName);
  const canBuzz = connected && phase !== "idle" && !hostBuzzed;

  const resolve = useCallback(
    (verdict: "correct" | "wrong" | "revealed") => {
      trackEvent("buzz_round_resolved", {
        round_index: roundIndex + 1,
        verdict,
        buzz_count: buzzCountRef.current,
      });
      if (verdict === "revealed") return hostReveal();
      hostVerdict(verdict);
    },
    [roundIndex, hostReveal, hostVerdict]
  );

  // Hand the room's controls up so the game page's own Reveal / Next / scoring
  // buttons drive it. Nothing here duplicates them.
  useEffect(() => {
    onControls?.({
      buzzes,
      correct: () => resolve("correct"),
      wrong: () => resolve("wrong"),
      reveal: () => resolve("revealed"),
      next: hostNext,
    });
  }, [buzzes, resolve, hostNext, onControls]);

  // Space is the host's buzzer. They're already at the keyboard running clips,
  // and making them pick up a second device to play was the thing this whole
  // feature exists to stop.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code !== "Space" && e.key !== " ") return;
      const el = e.target as HTMLElement | null;
      // Never steal the key from a text field or a focused button — space is
      // that button's own activation.
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (el && el.tagName === "BUTTON") return;
      e.preventDefault();
      if (canBuzz) buzz();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canBuzz, buzz]);

  return (
    <div className="rounded-2xl bg-[#1a1a1a] p-4 text-white">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-[#888]">Room</p>
          <p className="text-2xl font-bold tracking-[0.2em] text-[#1DB954]">{roomCode}</p>
          <p className="mt-1 text-xs text-[#888]">
            {connected
              ? `${(snapshot?.players ?? []).filter((p) => p.connected).length} connected`
              : "Connecting…"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowJoin((v) => !v)}
          className="rounded-lg bg-[#222] px-3 py-1.5 text-xs text-[#bbb]"
        >
          {showJoin ? "Hide QR" : "Show QR"}
        </button>
      </div>

      {showJoin && qr && (
        <div className="mt-3 flex flex-col items-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- client-generated data: URI */}
          <img src={qr} alt={`QR code to join room ${roomCode}`} className="h-32 w-32 rounded bg-white p-1" />
          <p className="mt-2 break-all text-center text-[10px] text-[#555]">{joinUrl}</p>
        </div>
      )}

      {/* The host's own buzzer. Same path as every phone — the room decides
          order, this is just another way in. */}
      <button
        type="button"
        onPointerDown={() => canBuzz && buzz()}
        disabled={!canBuzz}
        className="mt-3 w-full rounded-xl py-4 text-lg font-bold disabled:opacity-40"
        style={{
          background: hostBuzzed ? "#1a2a1a" : canBuzz ? "#1DB954" : "#181818",
          color: hostBuzzed ? "#8fd6a5" : canBuzz ? "#04120a" : "#666",
        }}
      >
        {hostBuzzed
          ? `You buzzed — #${buzzes.find((b) => b.name === hostName)?.order}`
          : phase === "idle"
          ? "Your buzzer (space)"
          : "BUZZ — space"}
      </button>

      <div className="mt-3 min-h-[3.5rem] rounded-xl bg-[#111] p-3">
        {current ? (
          <>
            <p className="text-2xl font-bold text-[#1DB954]">{current.name}</p>
            <p className="text-xs text-[#888]">
              {(current.msSinceOpen / 1000).toFixed(2)}s
              {buzzes.length > 1 && ` · ${buzzes.length - 1} more in the queue`}
            </p>
          </>
        ) : (
          <p className="text-sm text-[#666]">
            {phase === "open" ? "Open — nobody has buzzed yet" : "Waiting for the next clip"}
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
    </div>
  );
}
