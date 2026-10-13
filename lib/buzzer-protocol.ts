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
  /**
   * The "put them in order" round, as this socket may see it — see
   * `OrderRoundView`. Absent in a guess game, and absent for a socket that
   * did not join with the `order` capability.
   */
  order?: OrderRoundView;
}

// ---------------------------------------------------------------------------
// "Put them in order", one phone each
// ---------------------------------------------------------------------------
//
// The order game with a buzzer room hands every player the round's cards on
// their own phone. The host's page deals (it has the release years; the room
// never does), the phones arrange and lock in, and the host's page grades at
// the reveal and sends the results back through the room.
//
// **The year never reaches the room before the reveal.** A card is an id, a
// title, a credit and a cover. The year, the release date and the album name
// stay on the host's page (an album called "1989" names a year), so a phone
// cannot read the answer out of the network tab — the quiz's rule, one game
// over (`lib/quiz-store.ts`).
//
// **Additive, and gated on a capability.** A page built before these messages
// existed has a reducer with no `default`: an unknown frame leaves its state
// undefined and the next frame throws, which is the crash screen. So the room
// sends `order` frames, and the snapshot's `order`, only to a socket whose
// `join` listed `"order"` in `caps`. An old phone in such a room keeps a
// buzzer that never opens; it never crashes.

/** What a `join` may declare it understands. Unknown entries are ignored. */
export type BuzzerCapability = "order";

/** Upper bounds the room enforces on what the host deals. */
export const ORDER_MAX_CARDS = 6;
export const ORDER_CARD_ID_MAX = 64;
export const ORDER_CARD_TEXT_MAX = 200;
export const ORDER_CARD_ART_MAX = 500;

/** One card as a phone sees it. Never a year, a date or an album. */
export interface OrderCard {
  id: string;
  title: string;
  artist: string;
  /** Album art URL, or "" for none. */
  art: string;
}

/**
 * How one player's arrangement came out: the whole order, the oldest card
 * alone, or neither. Graded on the host's page (`gradeArrangement` in
 * lib/order-game.ts), and every player who earned it gets it — where the
 * shared screen's awards are one of each per round.
 */
export type OrderPhoneVerdict = "exact" | "oldest" | "none";

export interface OrderPhoneResult {
  verdict: OrderPhoneVerdict;
  points: number;
  /** False for a player who never locked in: verdict "none", no points. */
  locked: boolean;
}

export interface OrderReveal {
  /** The card ids, oldest first. */
  order: string[];
  /** Card id → release year. */
  years: Record<string, number>;
  /** playerId → result, for every seat the host graded. */
  results: Record<string, OrderPhoneResult>;
}

export interface OrderRoundView {
  /** The order page's 0-based round index — not the buzzer's `roundIndex`. */
  round: number;
  /** In the order they were dealt. */
  cards: OrderCard[];
  phase: "arranging" | "revealed";
  /** Who has locked in — ids only, never what they locked. */
  locked: string[];
  /** This socket's own locked arrangement, or null. */
  mine: string[] | null;
  /**
   * Every locked arrangement, by playerId. The host's socket only: a phone
   * that could read its neighbours' answers before the reveal could copy them.
   */
  arrangements?: Record<string, string[]>;
  reveal: OrderReveal | null;
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
      /** What this page understands beyond the buzzer. See `BuzzerCapability`. */
      caps?: BuzzerCapability[];
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
  /**
   * Deal an order round to every phone. Replaces whatever round the room
   * held, locks included: a new round, or the host's page dealing again
   * after a reload.
   */
  | { type: "host:order:deal"; hostToken: string; round: number; cards: OrderCard[] }
  /** The years go up, with every player's result. Ends the round's locking. */
  | { type: "host:order:reveal"; hostToken: string; round: number; reveal: OrderReveal }
  /** A player's arrangement, card ids top (oldest) to bottom. Re-sendable until the reveal. */
  | { type: "order:lock"; round: number; ids: string[] }
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
  /**
   * The order round changed: dealt, someone locked in, revealed. Built per
   * socket (`mine`, and `arrangements` for the host), and sent only to a
   * socket that joined with the `order` capability.
   */
  | { type: "order"; order: OrderRoundView }
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
    case "host:order:deal":
    case "host:order:reveal":
    case "order:lock":
    case "ping":
      return value as ClientMessage;
    default:
      return null;
  }
}
