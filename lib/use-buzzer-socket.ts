"use client";

/**
 * Browser side of Buzzer Mode. Speaks the protocol in lib/buzzer-protocol.ts to
 * the Cloudflare Worker, which is a different origin from this app — Next.js
 * stays on Vercel, only the live room lives on Cloudflare.
 *
 * Two things drive the design:
 *
 * 1. **The socket is not the identity.** A phone that locks, drops Wi-Fi, or
 *    backgrounds gets a brand new socket. `playerId` lives in localStorage and
 *    survives all of that, so the room can hand the same player their name,
 *    their place in the queue, and any outstanding penalty when they come back.
 *
 * 2. **The server's snapshot always wins.** On every open we send `join` and the
 *    room replays full state. We overwrite local state with it rather than
 *    merging, because a reconnecting client's idea of the round is exactly the
 *    thing that went stale.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BuzzerErrorCode,
  ClientMessage,
  RoomSnapshot,
  ServerMessage,
} from "@/lib/buzzer-protocol";

const PLAYER_ID_STORAGE_KEY = "guesssong_player_id";
const INITIAL_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30_000;

/**
 * Stable per-device id. Generated once and reused for every room this browser
 * ever joins, which is what makes reconnect-into-the-same-seat work.
 */
export function getPersistentPlayerId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(PLAYER_ID_STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(PLAYER_ID_STORAGE_KEY, id);
  }
  return id;
}

function socketUrl(code: string): string | null {
  const base = process.env.NEXT_PUBLIC_BUZZER_WS_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/rooms/${encodeURIComponent(code.toUpperCase())}/ws`;
}

export interface BuzzerSocketState {
  snapshot: RoomSnapshot | null;
  isHost: boolean;
  connected: boolean;
  /** Epoch ms (server clock) until which this player's button is locked out. */
  penaltyUntil: number | null;
  error: { code: BuzzerErrorCode; message: string } | null;
}

export interface BuzzerSocketApi extends BuzzerSocketState {
  playerId: string;
  buzz: () => void;
  hostOpen: () => void;
  hostVerdict: (verdict: "correct" | "wrong") => void;
  hostReveal: () => void;
  hostNext: () => void;
}

export interface UseBuzzerSocketOptions {
  code: string | null;
  name: string;
  /** Host only. Its presence is what makes the room grant host actions. */
  hostToken?: string;
  /** Fired for every server message, so callers can drive analytics. */
  onServerMessage?: (msg: ServerMessage) => void;
}

export function useBuzzerSocket({
  code,
  name,
  hostToken,
  onServerMessage,
}: UseBuzzerSocketOptions): BuzzerSocketApi {
  const [state, setState] = useState<BuzzerSocketState>({
    snapshot: null,
    isHost: false,
    connected: false,
    penaltyUntil: null,
    error: null,
  });

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delayRef = useRef(INITIAL_RECONNECT_MS);
  /** Set on unmount so a close event doesn't schedule a doomed reconnect. */
  const closedRef = useRef(false);

  const playerId = useMemo(() => getPersistentPlayerId(), []);

  // Kept in refs so the connect effect depends only on `code` — putting `name`
  // or the callback in the dep array would tear down and rebuild the socket on
  // every keystroke or parent re-render.
  const nameRef = useRef(name);
  const hostTokenRef = useRef(hostToken);
  const onMessageRef = useRef(onServerMessage);
  nameRef.current = name;
  hostTokenRef.current = hostToken;
  onMessageRef.current = onServerMessage;

  const send = useCallback((msg: ClientMessage) => {
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    if (!code || !playerId) return;
    const url = socketUrl(code);
    if (!url) {
      setState((s) => ({
        ...s,
        error: {
          code: "bad_message",
          message: "NEXT_PUBLIC_BUZZER_WS_URL is not set — buzzer rooms are unavailable",
        },
      }));
      return;
    }

    closedRef.current = false;

    const connect = () => {
      if (closedRef.current) return;
      const ws = new WebSocket(url);
      socketRef.current = ws;

      ws.addEventListener("open", () => {
        delayRef.current = INITIAL_RECONNECT_MS;
        setState((s) => ({ ...s, connected: true, error: null }));
        ws.send(
          JSON.stringify({
            type: "join",
            playerId,
            name: nameRef.current,
            ...(hostTokenRef.current ? { hostToken: hostTokenRef.current } : {}),
          } satisfies ClientMessage)
        );
      });

      ws.addEventListener("message", (event) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }
        onMessageRef.current?.(msg);
        setState((s) => reduce(s, msg));
      });

      ws.addEventListener("close", () => {
        setState((s) => ({ ...s, connected: false }));
        if (closedRef.current) return;
        // Exponential backoff so a room that is genuinely gone doesn't turn six
        // phones into a reconnect storm against the Worker.
        reconnectRef.current = setTimeout(connect, delayRef.current);
        delayRef.current = Math.min(delayRef.current * 2, MAX_RECONNECT_MS);
      });

      ws.addEventListener("error", () => {
        // 'close' always follows, and that is where reconnect is handled.
      });
    };

    connect();

    return () => {
      closedRef.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [code, playerId]);

  const buzz = useCallback(() => {
    const roundIndex = state.snapshot?.roundIndex;
    if (roundIndex === undefined) return;
    send({ type: "buzz", roundIndex });
  }, [send, state.snapshot?.roundIndex]);

  const hostSend = useCallback(
    (msg: Extract<ClientMessage, { hostToken: string }>) => {
      if (!hostTokenRef.current) return;
      send(msg);
    },
    [send]
  );

  return {
    ...state,
    playerId,
    buzz,
    hostOpen: useCallback(
      () => hostSend({ type: "host:open", hostToken: hostTokenRef.current ?? "" }),
      [hostSend]
    ),
    hostVerdict: useCallback(
      (verdict: "correct" | "wrong") =>
        hostSend({ type: "host:verdict", hostToken: hostTokenRef.current ?? "", verdict }),
      [hostSend]
    ),
    hostReveal: useCallback(
      () => hostSend({ type: "host:reveal", hostToken: hostTokenRef.current ?? "" }),
      [hostSend]
    ),
    hostNext: useCallback(
      () => hostSend({ type: "host:next", hostToken: hostTokenRef.current ?? "" }),
      [hostSend]
    ),
  };
}

/**
 * Pure reducer over server messages. Kept exported and side-effect free so the
 * state machine can be unit-tested without a socket.
 */
export function reduce(state: BuzzerSocketState, msg: ServerMessage): BuzzerSocketState {
  switch (msg.type) {
    case "state":
      return {
        ...state,
        snapshot: msg.snapshot,
        isHost: msg.you.isHost || state.isHost,
        error: null,
      };
    case "round:open":
      return state.snapshot
        ? {
            ...state,
            snapshot: {
              ...state.snapshot,
              phase: "open",
              roundIndex: msg.roundIndex,
              roundOpenedAt: msg.openedAt,
              buzzes: [],
            },
          }
        : state;
    case "buzz":
      if (!state.snapshot) return state;
      // The room is authoritative on order, so append only if this entry is new
      // — a reconnect mid-round can replay a buzz we already have.
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          phase: msg.phase,
          buzzes: state.snapshot.buzzes.some((b) => b.playerId === msg.entry.playerId)
            ? state.snapshot.buzzes
            : [...state.snapshot.buzzes, msg.entry],
        },
      };
    case "round:resolved":
      return state.snapshot
        ? { ...state, snapshot: { ...state.snapshot, phase: "idle", roundOpenedAt: null } }
        : state;
    case "players":
      return state.snapshot
        ? { ...state, snapshot: { ...state.snapshot, players: msg.players } }
        : state;
    case "penalty":
      return { ...state, penaltyUntil: msg.untilMs };
    case "error":
      return { ...state, error: { code: msg.code, message: msg.message } };
    case "pong":
      return state;
  }
}
