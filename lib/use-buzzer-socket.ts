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
 *    their place in the queue when they come back.
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
import { buzzerWorkerUrl } from "@/lib/buzzer-client";
import { readStored, writeStored } from "@/lib/host-session";
import type { BuzzerClientErrorCode } from "@/lib/error-messages";

const PLAYER_ID_STORAGE_KEY = "guesssong_player_id";
const INITIAL_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30_000;
/**
 * Consecutive never-opened attempts before we call the room dead. Three, not
 * one: a phone waking up on a flaky network legitimately fails the first
 * attempt or two, and telling that player their room is gone would be worse
 * than making them wait a few seconds.
 */
const MAX_FAILED_OPENS = 3;

/**
 * A fresh v4 UUID, on every browser that can open a socket.
 *
 * `crypto.randomUUID` alone is what this used to be, and it is the second
 * browser API in this file to have taken a whole surface down on an older
 * phone (the first was the socket URL's scheme, see `socketUrl`). It arrived
 * in Safari 15.4, Chrome 92 and Firefox 95 — 2021 to 2022 — and every engine
 * before that throws `TypeError: crypto.randomUUID is not a function`. The
 * call runs inside `useMemo` during the first render of `useBuzzerSocket`, so
 * the throw reached app/error.tsx: the setup page became "The game stopped"
 * the moment Buzzer Mode was switched on, `/game` did the same in a buzzer
 * game, and a player landing on `/buzz/[code]` never saw the form. Every
 * attempt repeated it, because nothing had been written to try again with.
 * Reported as "I can't start the game, it always gives an error and asks me
 * to restart". It never reproduces on a developer's machine, for the same
 * reason the scheme bug never did.
 *
 * `getRandomValues` has been in every engine since 2012 and gives the same
 * RFC 4122 v4 shape, so the Worker is handed an identity it cannot tell from
 * the fast path's. The `Math.random` tier is for a context with no `crypto`
 * at all; it keeps the shape and gives up the entropy, which a party buzzer
 * does not need.
 */
export function mintPlayerId(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The shape every id this module has ever minted has: RFC 4122 v4. The stored
 * value is read back through this before it is handed to the Worker, so a
 * corrupted or hand-edited key is minted over rather than sent as the hash key
 * the room persists under — and a player with a broken key loses one seat,
 * which is the recovery.
 */
const PLAYER_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The last id this page presented to a room, whichever branch handed it out.
 * The setup page's room panel and the game page's host panel each mount their
 * own `useBuzzerSocket`, and the room has to see one host across that
 * navigation, not a second player arriving as the first leaves. Recorded on
 * the storage-hit branch too, so a read that succeeds on `/` and is refused
 * on `/game` (quota, a private-mode transition) still presents the same id.
 */
let pageScopedPlayerId: string | null = null;

/** Test seam, in the shape of `__resetLivenessForTests` in lib/loop-stats.ts. */
export function __resetPlayerIdForTests(): void {
  pageScopedPlayerId = null;
}

/**
 * Stable per-device id. Generated once and reused for every room this browser
 * ever joins, which is what makes reconnect-into-the-same-seat work.
 *
 * Storage goes through lib/host-session.ts's guard for the reason it and
 * lib/game-storage.ts give: a locked-down browser throws on the property
 * access itself, and this ran unguarded during render. On such a device the
 * seat lasts the page rather than the device, and the game still plays — a
 * reload on that device is a new player to the room, see docs/operations.md.
 */
export function getPersistentPlayerId(): string {
  if (typeof window === "undefined") return "";
  const stored = readStored(PLAYER_ID_STORAGE_KEY);
  if (stored && PLAYER_ID_SHAPE.test(stored)) {
    pageScopedPlayerId = stored;
    return stored;
  }
  const id = pageScopedPlayerId ?? mintPlayerId();
  pageScopedPlayerId = id;
  writeStored(PLAYER_ID_STORAGE_KEY, id);
  return id;
}

/**
 * The URL a room's socket opens on, in the scheme every browser's WebSocket
 * constructor accepts.
 *
 * `NEXT_PUBLIC_BUZZER_WS_URL` is documented as `wss://`, and production was
 * set to `https://`. Both name the same Worker — a WebSocket upgrade is an
 * HTTPS request — and every browser since Chrome 125, Firefox 124 and Safari
 * 17.3 normalises the scheme itself, which is why nothing on a developer's
 * machine ever noticed. Anything older throws `SyntaxError: The URL's scheme
 * must be either 'ws' or 'wss'` from the constructor, inside the connect
 * effect below, and the route error boundary turns that into "The game
 * stopped" on the phone the moment the player taps Join Room. The host sees
 * nobody arrive. An iPhone 8 or X cannot run iOS 17, so this is not a
 * hypothetical population.
 *
 * The rule is the mirror of `httpOrigin()` in lib/buzzer-client.ts, which
 * folds `ws` into `http` for the one POST; each side accepts either spelling,
 * so the env var is one value rather than two that can disagree.
 */
export function socketUrl(code: string): string | null {
  const base = buzzerWorkerUrl();
  if (!base) return null;
  let origin = base.replace(/^http(s?):\/\//i, (_, s: string) => `ws${s.toLowerCase()}://`);
  // A plain ws:// from an https page is mixed content, and Chrome and Firefox
  // refuse it *synchronously*, from the constructor — the same throw-in-the-
  // connect-effect shape as the scheme bug above, reachable by pasting the
  // Worker's URL as http:// (which is how wrangler prints a dev Worker). The
  // Worker is always TLS on workers.dev, so an https page can only ever mean
  // wss://; a dev page on http keeps whatever it was given.
  if (isSecurePage()) origin = origin.replace(/^ws:\/\//i, "wss://");
  return `${origin}/rooms/${encodeURIComponent(code.toUpperCase())}/ws`;
}

function isSecurePage(): boolean {
  return typeof window !== "undefined" && window.location?.protocol === "https:";
}

export interface BuzzerSocketState {
  snapshot: RoomSnapshot | null;
  isHost: boolean;
  connected: boolean;
  /**
   * `code` is what gets rendered — through `buzzerErrorMessage`, in whatever
   * language the phone reads and for whichever chair is reading it. The two
   * client codes are the page's own: the socket was never opened. `message`
   * is English and is a fallback for a Worker newer than this page, so
   * nothing should print it directly.
   */
  error: { code: BuzzerErrorCode | BuzzerClientErrorCode; message: string } | null;
}

export interface BuzzerSocketApi extends BuzzerSocketState {
  playerId: string;
  /**
   * Start over: a fresh socket, the give-up counter and the last refusal
   * cleared. The way out of `no_answer` — the room could not be reached
   * three times running, which a captive portal or a dropped connection
   * produces as readily as a room that has ended — without a reload.
   */
  reconnect: () => void;
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
    error: null,
  });

  const socketRef = useRef<WebSocket | null>(null);
  const delayRef = useRef(INITIAL_RECONNECT_MS);
  /**
   * Consecutive connection attempts that closed without ever opening.
   *
   * A room that doesn't exist is refused at the upgrade with a 404, so the
   * socket never opens and the server's `room_expired` message can never
   * arrive — there is no socket to deliver it on. Without this counter a
   * mistyped code leaves the player staring at "connecting…" forever while
   * the client retries a room that will never exist.
   */
  const failedOpensRef = useRef(0);

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

  // Bumped by `reconnect()`; a dependency of the connect effect, so bumping
  // it tears the current socket down and opens a fresh one.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Every run starts clean, the null-code run included. The refusal and
    // the give-up counter belong to the socket that earned them: carried
    // over, "Try a different name" showed the old refusal until the new
    // socket answered, and a fresh attempt after a give-up was refused on
    // its first close. The snapshot belongs to the room that sent it: a new
    // room on `/` showed the old one's roster until its own state landed.
    failedOpensRef.current = 0;
    delayRef.current = INITIAL_RECONNECT_MS;
    setState((s) =>
      s.snapshot || s.connected || s.isHost || s.error
        ? { snapshot: null, isHost: false, connected: false, error: null }
        : s
    );
    if (!code || !playerId) return;
    const url = socketUrl(code);
    if (!url) {
      setState((s) => ({
        ...s,
        error: {
          code: "not_configured",
          message: "NEXT_PUBLIC_BUZZER_WS_URL is not set — buzzer rooms are unavailable",
        },
      }));
      return;
    }

    // Scoped to THIS effect run, not a ref shared across runs. A ref was a real
    // bug: React remounts effects (StrictMode in dev, any dep change in prod),
    // and the sequence went
    //
    //   run 1 connects A -> cleanup closes A and sets the ref -> run 2 clears
    //   the ref and connects B -> A's close event finally fires, reads the
    //   *cleared* ref, concludes it dropped unexpectedly, and reconnects as C
    //
    // leaving B and C both live. The room deduped them by playerId so the phone
    // count looked right, while every broadcast arrived twice and doubled every
    // analytics event. A closure variable can't be clobbered by a later run.
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      // The constructor throws synchronously — a fragment in the URL, a
      // scheme the page may not open, no WebSocket at all — and this runs
      // from the effect body, so an unguarded throw is app/error.tsx in
      // place of the page: the third such call on this path, after the id
      // and the storage above. Deterministic, so there is nothing to retry;
      // the page says so, and the console carries the operator's half.
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        console.error("[buzzer] the browser refused to open the room's socket — check NEXT_PUBLIC_BUZZER_WS_URL", url, e);
        setState((s) => ({
          ...s,
          connected: false,
          error: { code: "unreachable", message: "The buzzer room can't be opened from this page" },
        }));
        return;
      }
      socketRef.current = ws;
      // Per-attempt, not a ref: distinguishes "the room refused us" from "we
      // were connected and the connection dropped", which need opposite
      // responses (give up vs keep retrying).
      let openedThisAttempt = false;

      ws.addEventListener("open", () => {
        openedThisAttempt = true;
        delayRef.current = INITIAL_RECONNECT_MS;
        failedOpensRef.current = 0;
        // `error` is not cleared here: the join is not answered yet. An
        // evicted taker's own reconnect opens fine and is then refused, and
        // clearing on open flipped its screen to a live buzzer for the
        // round trip in between. The reducer clears it on `state`.
        setState((s) => ({ ...s, connected: true }));
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
        // A socket orphaned by a remount must not keep driving state or firing
        // analytics on its way out.
        if (cancelled) return;
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
        if (cancelled) return;
        setState((s) => ({ ...s, connected: false }));

        if (ws.readyState === WebSocket.CLOSED && !openedThisAttempt) {
          failedOpensRef.current += 1;
          if (failedOpensRef.current >= MAX_FAILED_OPENS) {
            // Say so, and keep trying slowly. From here a room refused at
            // the upgrade (a wrong or expired code) and a connection that
            // never got through (a captive portal, a dropped network, three
            // 429s from the shared join limiter) look identical, so the code
            // is the page's own `no_answer` rather than the Worker's
            // `room_expired`, and the screen offers `reconnect()`. Stopping
            // here used to end the host's buzzer for the rest of the party
            // after a Wi-Fi blip of seven seconds — a reload is round one
            // with the scores wiped — so the retry goes on at the ceiling.
            setState((s) => ({
              ...s,
              error: {
                code: "no_answer",
                message: "Couldn't reach the room — check the code and the connection",
              },
            }));
            delayRef.current = MAX_RECONNECT_MS;
          }
        }

        // Exponential backoff so a room that is genuinely gone doesn't turn six
        // phones into a reconnect storm against the Worker.
        reconnectTimer = setTimeout(connect, delayRef.current);
        delayRef.current = Math.min(delayRef.current * 2, MAX_RECONNECT_MS);
      });

      ws.addEventListener("error", () => {
        // 'close' always follows, and that is where reconnect is handled.
      });
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [code, playerId, attempt]);

  const reconnect = useCallback(() => setAttempt((n) => n + 1), []);

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
    reconnect,
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
    case "buzz": {
      if (!state.snapshot) return state;
      // One frame, two meanings, told apart by whether we already know this
      // player:
      //
      // - **New to us** — someone just buzzed. Append them to the queue.
      // - **Already queued** — the host called the previous answer wrong and the
      //   room shifted the queue onto this entry. Everyone ahead of them is out
      //   of this round, so drop them.
      //
      // Treating the second case as a duplicate to ignore was a real bug: the
      // host tapped "Wrong", the room advanced, and their screen kept the
      // eliminated player at the head of the queue for the rest of the round.
      // A reconnecting client replaying the current head lands on index 0 and
      // changes nothing, which is still what we want.
      //
      // Matched on the id only. A seat taken over mid-round re-keys its
      // queued buzz (worker/src/buzzer-room.ts `takeSeat`), and the room
      // answers that with a full `state` replay, which is what keeps this
      // queue in step — not `order`: the room numbers a buzz by the queue's
      // length and does not renumber after a wrong verdict shifts it, so
      // two entries in one round can share an `order`, and matching on it
      // dropped a real buzz on the floor.
      const known = state.snapshot.buzzes.findIndex((b) => b.playerId === msg.entry.playerId);
      const buzzes =
        known === -1
          ? [...state.snapshot.buzzes, msg.entry]
          : known === 0
          ? state.snapshot.buzzes
          : state.snapshot.buzzes.slice(known);
      return { ...state, snapshot: { ...state.snapshot, phase: msg.phase, buzzes } };
    }
    case "round:resolved":
      // The queue deliberately outlives the round. The host reveals the answer
      // first and scores second, so "who buzzed" is exactly what the scoring UI
      // needs at the moment this arrives — clearing it here sent the host back
      // to picking a name out of the full player list. `host:next` is what wipes
      // it, on the server and here, and that matches handleResolve leaving
      // room.buzzes untouched.
      return state.snapshot
        ? { ...state, snapshot: { ...state.snapshot, phase: "idle", roundOpenedAt: null } }
        : state;
    case "players":
      return state.snapshot
        ? { ...state, snapshot: { ...state.snapshot, players: msg.players } }
        : state;
    case "error":
      return { ...state, error: { code: msg.code, message: msg.message } };
    case "pong":
      return state;
  }
}
