/**
 * Wire protocol for Buzzer Mode, shared verbatim by the Next.js client and the
 * Cloudflare Worker / Durable Object that hosts the room.
 *
 * This file is imported from BOTH sides of the network boundary:
 *   - Next.js:  `@/lib/buzzer-protocol`
 *   - Worker:   `../../lib/buzzer-protocol` (see worker/tsconfig.json)
 *
 * So it must stay dependency-free — types and plain constants only, no imports
 * from `@/…`, no `node:` builtins, nothing Next-specific. If you need a helper
 * that touches either runtime, put it on that side of the boundary instead.
 *
 * ## Why a Durable Object and not polling
 *
 * The whole game hinges on one guarantee: "who pressed first" must be decided by
 * a single atomic server-side operation. A Durable Object gives that for free —
 * one DO instance per room code, single-threaded, so the buzz handler runs to
 * completion without another buzz interleaving. No locks, no CAS, no retry loop.
 *
 * The host's screen is a *display* of that decision, never the decision itself,
 * which is why display latency is a UX question and not a correctness one.
 */

/**
 * Matches `ROOM_CODE_ALPHABET` in lib/room.ts:24 on purpose — Mixed Playlist
 * rooms and Buzzer rooms both show codes to the same humans in the same room,
 * so they exclude the same visually-confusable characters (0/O, 1/I/L).
 * The two systems are otherwise independent: a Mixed Playlist room is a one-shot
 * playlist mailbox in Upstash, a Buzzer room is a live DO. Same look, different
 * lifetime, deliberately not shared storage.
 */
export const BUZZER_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const BUZZER_CODE_LENGTH = 4;

/** Max phones in one buzzer room, matching ROOM_MAX_SUBMISSIONS. */
export const BUZZER_MAX_PLAYERS = 12;

/**
 * How long a buzzer room survives with no host activity. Unlike Mixed Playlist
 * rooms — whose TTL counts down from creation because they're a one-shot inbox
 * (see the room-ttl-does-not-slide hazard) — this one *slides*: every host
 * action pushes the alarm out again. A game that runs long is the normal case
 * here, not an edge case.
 */
export const BUZZER_IDLE_TIMEOUT_MS = 3 * 60 * 60 * 1000;

export type BuzzerPhase =
  /** Between rounds. Buttons disabled. */
  | "idle"
  /** Clip is playing or has played. Buttons live. */
  | "open"
  /** Someone got there first. Their name is up; the rest are queued behind. */
  | "locked";

export type RoundVerdict = "correct" | "wrong" | "revealed";

export interface BuzzEntry {
  playerId: string;
  name: string;
  /** 1-based arrival order within this round. Assigned by the DO, never the client. */
  order: number;
  /** Milliseconds from round open to the DO receiving this buzz. */
  msSinceOpen: number;
}

export interface PlayerSummary {
  playerId: string;
  name: string;
  connected: boolean;
}

/**
 * Everything a client needs to render the room from cold. Sent on every join,
 * which is also every reconnect — clients are expected to throw away local
 * state and adopt this wholesale rather than trying to diff.
 */
export interface RoomSnapshot {
  code: string;
  phase: BuzzerPhase;
  roundIndex: number;
  /** DO clock, epoch ms. Null while idle. */
  roundOpenedAt: number | null;
  /** Arrival-ordered. First entry is the current buzzer while phase is "locked". */
  buzzes: BuzzEntry[];
  players: PlayerSummary[];
  /** Epoch ms this room expires if the host does nothing further. */
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export type ClientMessage =
  /**
   * First message on every connection, including reconnects. `playerId` is a
   * client-generated UUID persisted in localStorage — the identity that survives
   * reconnects, because the underlying socket does not.
   */
  | {
      type: "join";
      playerId: string;
      name: string;
      /** Host must present the token minted at room creation. */
      hostToken?: string;
    }
  | {
      type: "buzz";
      /** Echoed back so a buzz for a stale round can be dropped server-side. */
      roundIndex: number;
    }
  | { type: "host:open"; hostToken: string }
  | { type: "host:verdict"; hostToken: string; verdict: "correct" | "wrong" }
  | { type: "host:reveal"; hostToken: string }
  | { type: "host:next"; hostToken: string }
  | { type: "ping" };

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

export type ServerMessage =
  /** Full state. Sent on join/reconnect; adopt it wholesale. */
  | { type: "state"; snapshot: RoomSnapshot; you: { playerId: string; isHost: boolean } }
  | { type: "round:open"; roundIndex: number; openedAt: number }
  /** Someone buzzed. Broadcast to everyone, including the buzzer. */
  | { type: "buzz"; entry: BuzzEntry; phase: BuzzerPhase }
  | { type: "round:resolved"; roundIndex: number; verdict: RoundVerdict }
  | { type: "players"; players: PlayerSummary[] }
  | { type: "error"; code: BuzzerErrorCode; message: string }
  | { type: "pong" };

export type BuzzerErrorCode =
  | "room_full"
  | "name_taken"
  | "not_host"
  | "bad_message"
  | "not_joined"
  | "room_expired";

/** Narrowing helper so both sides parse untrusted frames the same way. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== "string") return null;
  switch (type) {
    case "join":
    case "buzz":
    case "host:open":
    case "host:verdict":
    case "host:reveal":
    case "host:next":
    case "ping":
      return value as ClientMessage;
    default:
      return null;
  }
}
