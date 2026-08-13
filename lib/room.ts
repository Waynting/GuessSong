/**
 * Server-only room mailbox for Mixed Playlist Mode's QR submission flow (v1).
 * A room is a one-shot TTL'd inbox: players submit playlist URLs, the host
 * polls status, then pulls+consumes the pool once. No realtime sync needed —
 * polling is spec-approved (§4.2), so this stays on top of lib/kv.ts's KV
 * abstraction rather than a WebSocket room.
 *
 * ## The room is a hash, and each contribution's tracks are their own key
 *
 *   room:v2:<CODE>              hash
 *     meta                      { code, hostToken, createdAt, expiresAt }
 *     consumed                  the attempt id that won the consume race
 *     p:<folded name>           { playerName, trackCount, joinedAt }
 *   room:v2:<CODE>:t:<folded name>   the contributor's tracks
 *
 * It was one JSON blob under `room:<CODE>`, and the split fixes two separate
 * problems that the blob made into one.
 *
 * **Writing.** Two players submitting within the same few seconds — the normal
 * case for a QR everyone scans at once — both read the blob, both add
 * themselves, and the second write drops the first. There is no CAS on get/set,
 * so the old code re-read before writing and then read *again* afterwards to
 * check whether it had been clobbered, retrying up to five times: four commands
 * on the happy path, ten on a contended one, and still only a narrowing of the
 * window rather than a close of it. Claiming `p:<name>` with `hsetnx` is one
 * command that atomically wins or loses. No verify, no retry loop, no race.
 *
 * **Reading.** The host polls the roster every few seconds and needs names and
 * track *counts* — but the blob carried every contributor's full track list, so
 * each poll dragged the whole pool across the wire to render a dozen chips. The
 * counts live in the hash and the tracks live in keys nobody reads until the
 * game starts, so a poll is now a small, fixed-size read whatever is in the
 * room. `consumeRoomPool` picks the track keys up with one `mget`.
 *
 * The `v2:` in the key prefix is a deliberate cold start: the old value is a
 * string and every command here is a hash command, so a room open across the
 * deploy would answer `WRONGTYPE` rather than politely 404. Old keys are
 * unreachable and age out within `ROOM_TTL_SECONDS`; a host mid-lobby at deploy
 * time sees "room not found" and reopens.
 */

import { randomUUID, timingSafeEqual } from "node:crypto";
import { loadPlaylist } from "@/lib/playlist-cache";
import { poolContributions } from "@/lib/mixed-playlist";
import { getKvStore } from "@/lib/kv";
import { stripTrackForStorage } from "@/lib/game-session";
import { errorMessage, type AppErrorCode } from "@/lib/error-messages";
import { SpotifyApiError } from "@/lib/spotify";
import type { Track } from "@/types";
import {
  ROOM_CODE_LENGTH,
  ROOM_TTL_SECONDS,
  ROOM_MAX_SUBMISSIONS,
  type RoomStatusResponse,
  type RoomPoolResponse,
} from "@/types/room";

// Excludes visually-confusable characters (0/O, 1/I/L) per spec §4.2.
const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** The one field that must exist for a room to exist at all. */
const META_FIELD = "meta";
/** Presence means the host has already started; the value says who won. */
const CONSUMED_FIELD = "consumed";
const ROSTER_PREFIX = "p:";

interface RoomMeta {
  code: string;
  hostToken: string;
  createdAt: number;
  expiresAt: number;
}

/** What the roster poll renders. Deliberately free of track payloads. */
interface RosterEntry {
  playerName: string;
  trackCount: number;
  /**
   * Hash fields have no order, and a roster that reshuffled itself between
   * polls would be a visible defect on a screen a room full of people is
   * watching. Arrival order is also the order everyone expects.
   */
  joinedAt: number;
}

interface LoadedRoom {
  meta: RoomMeta;
  /** The winning attempt id, or null while the room is still open. */
  consumedBy: string | null;
  /** Arrival order, with the folded name each entry was stored under. */
  roster: Array<RosterEntry & { folded: string }>;
}

/**
 * `code` is what the route sends and the client renders in its own language —
 * `message` is the English rendering, and exists for logs. A room is the one
 * place where the two sides of a failure are reliably different people: the
 * host reads their laptop, the refused player reads their phone. See
 * lib/error-messages.ts.
 */
export class RoomError extends Error {
  readonly params?: Record<string, string | number>;
  readonly retryAfterSeconds?: number;

  constructor(
    readonly code: AppErrorCode,
    readonly status: number,
    options: {
      /** Fills the message's placeholders. Required by the codes that have one. */
      params?: Record<string, string | number>;
      retryAfterSeconds?: number;
    } = {}
  ) {
    super(errorMessage(code, "en", { params: options.params }));
    this.name = "RoomError";
    this.params = options.params;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

function roomKey(code: string): string {
  return `room:v2:${code.toUpperCase()}`;
}

/**
 * One player's name, folded to what identifies them.
 *
 * The same string keys their hash field and their tracks key, so it has to be
 * derived in exactly one place: two spellings of the fold would let a player
 * claim a roster slot under one key and write their tracks under another, and
 * they would then appear in the room with a playlist that never reaches the
 * pool. Case-insensitive because that is the duplicate check players expect —
 * "alice" is already taken by "Alice".
 */
function fold(playerName: string): string {
  return playerName.trim().toLowerCase();
}

function rosterField(playerName: string): string {
  return `${ROSTER_PREFIX}${fold(playerName)}`;
}

/** Tracks live outside the hash so the roster poll never carries them. */
function tracksKey(code: string, folded: string): string {
  return `${roomKey(code)}:t:${folded}`;
}

/**
 * Reads the whole room as one command, and decides whether it still exists.
 *
 * The wall-clock check is not redundant with the TTL. `createRoom` sets the
 * expiry in a second command after the hash exists, so there is a window — and,
 * if that command were ever lost, a key — where Redis would still serve a room
 * whose own `expiresAt` has passed. Trusting the record over the eviction
 * policy costs nothing and means the room ends when it said it would.
 */
async function loadRoom(code: string): Promise<LoadedRoom | null> {
  const store = await getKvStore();
  const raw = await store.hgetall<unknown>(roomKey(code));

  const meta = raw[META_FIELD] as RoomMeta | undefined;
  if (!meta || typeof meta.expiresAt !== "number") return null;
  if (Date.now() >= meta.expiresAt) return null;

  const consumedField = raw[CONSUMED_FIELD];
  const roster: Array<RosterEntry & { folded: string }> = [];
  for (const [field, value] of Object.entries(raw)) {
    if (!field.startsWith(ROSTER_PREFIX)) continue;
    const entry = value as RosterEntry;
    if (!entry || typeof entry.playerName !== "string") continue;
    roster.push({ ...entry, folded: field.slice(ROSTER_PREFIX.length) });
  }
  roster.sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0));

  return {
    meta,
    consumedBy: typeof consumedField === "string" ? consumedField : null,
    roster,
  };
}

function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/** Shape check only — says nothing about whether the code is in use. */
function isWellFormedCode(code: string): boolean {
  return (
    code.length === ROOM_CODE_LENGTH &&
    [...code].every((c) => ROOM_CODE_ALPHABET.includes(c))
  );
}

function remainingTtlSeconds(meta: RoomMeta): number {
  return Math.max(1, Math.round((meta.expiresAt - Date.now()) / 1000));
}

/**
 * Claims a code by writing `meta`, and returns null if someone else holds it.
 *
 * `hsetnx` is the claim: it is the only command here, and it either creates the
 * room or reports that the code is taken. The old two-step — read the code,
 * then write it if nothing came back — could hand the same code to two hosts
 * that checked at the same moment, which for a 4-character space shared with
 * Buzzer Mode's Durable Objects is not as unlikely as it sounds.
 */
async function claimRoomCode(
  store: Awaited<ReturnType<typeof getKvStore>>,
  code: string
): Promise<{ roomCode: string; expiresAt: number; hostToken: string } | null> {
  const now = Date.now();
  const meta: RoomMeta = {
    code,
    hostToken: randomUUID(),
    createdAt: now,
    expiresAt: now + ROOM_TTL_SECONDS * 1000,
  };
  if (!(await store.hsetnx(roomKey(code), META_FIELD, meta))) return null;

  try {
    await store.expire(roomKey(code), ROOM_TTL_SECONDS);
  } catch (err) {
    // A hash created by HSETNX has no expiry of its own, so a room whose
    // `expire` never landed would hold its code forever — and this code may be
    // one Buzzer Mode is about to reuse. Undo the claim rather than leak it.
    await store.del(roomKey(code)).catch(() => {});
    throw err;
  }
  return { roomCode: code, expiresAt: meta.expiresAt, hostToken: meta.hostToken };
}

/**
 * Open a playlist mailbox, optionally under a code the caller already owns.
 *
 * `requestedCode` is what lets one code drive both room systems. Buzzer Mode
 * claims its Durable Object first and passes the claimed code here, so a party
 * scans one QR instead of two. Passing a code is only safe *because* of that
 * ordering: the DO is held before the code is ever shown, so there is nothing
 * for a guest to race for. A 409 means the code is already a live playlist
 * room — the caller should claim a fresh one rather than join someone else's.
 *
 * Called with no argument (the Mixed-only flow) it keeps generating its own.
 */
export async function createRoom(requestedCode?: string): Promise<{
  roomCode: string;
  expiresAt: number;
  hostToken: string;
}> {
  const store = await getKvStore();

  if (requestedCode !== undefined) {
    const code = requestedCode.trim().toUpperCase();
    if (!isWellFormedCode(code)) {
      throw new RoomError("room_code_invalid", 422);
    }
    const claimed = await claimRoomCode(store, code);
    if (!claimed) throw new RoomError("room_code_taken", 409);
    return claimed;
  }

  // Small retry loop for the unlikely event of a code collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const claimed = await claimRoomCode(store, generateRoomCode());
    if (claimed) return claimed;
  }
  throw new RoomError("room_code_unavailable", 500);
}

async function requireOpenRoom(code: string): Promise<LoadedRoom> {
  const room = await loadRoom(code);
  if (!room) throw new RoomError("room_not_found", 404);
  if (room.consumedBy) throw new RoomError("room_already_started", 410);
  return room;
}

/**
 * The two reasons a submission is refused even though the room is open.
 *
 * Checked once, against a fresh read, before the playlist fetch. The name half
 * is then enforced for real by `hsetnx` — this is the courteous early answer,
 * not the decision. The size half has no atomic equivalent and does not need
 * one: see the note on the cap in `submitToRoom`.
 */
function assertCanJoin(room: LoadedRoom, trimmedName: string): void {
  const folded = fold(trimmedName);
  if (room.roster.some((entry) => entry.folded === folded)) {
    throw new RoomError("room_name_taken", 409);
  }
  if (room.roster.length >= ROOM_MAX_SUBMISSIONS) {
    throw new RoomError("room_full", 409);
  }
}

/**
 * Adds one player's playlist to the mailbox.
 *
 * The claim is `hsetnx` on the player's roster field: one command that either
 * wins the name or does not, replacing the read-modify-write-verify-retry loop
 * this used to need. What is left is bookkeeping around it — the tracks are
 * written first so that a slot never exists without its playlist, and the room
 * is re-read afterwards only to catch a host who pressed Start in between.
 */
export async function submitToRoom(
  code: string,
  playerName: string,
  playlistUrl: string
): Promise<{ trackCount: number }> {
  // Validate the room is currently open before doing the slow network work
  // below, so a request against a dead room fails fast.
  const openRecord = await requireOpenRoom(code);

  const trimmedName = playerName.trim();
  if (!trimmedName) throw new RoomError("room_name_required", 422);

  // Both rejections, checked against the record we already hold. Advisory for
  // the name — `hsetnx` below is what actually decides — but it moves the
  // common cases (a player retrying under a name someone just took, a 13th
  // phone scanning a full room) to *before* the playlist fetch. Those used to
  // spend a full pagination against the shared Spotify quota only to answer
  // with a 409.
  assertCanJoin(openRecord, trimmedName);

  let tracks: Track[];
  try {
    ({ tracks } = await loadPlaylist(playlistUrl, "room-submit"));
  } catch (err) {
    // Carry the upstream code through rather than flattening it. A player
    // whose submission lands during a Spotify cooldown is not holding a broken
    // playlist, and telling them so sends them back to editing a URL that was
    // always fine — the same failure /api/playlist is careful not to make. The
    // 429 keeps its status for the same reason: the client has to be able to
    // tell "your playlist is wrong" from "we are throttled".
    if (err instanceof SpotifyApiError) {
      throw new RoomError(err.code, err.status === 429 ? 429 : 422, {
        params: err.params,
        retryAfterSeconds: err.retryAfterSeconds,
      });
    }
    throw new RoomError("playlist_load_failed", 422);
  }
  if (tracks.length < 1) {
    throw new RoomError("playlist_empty", 422);
  }
  const strippedTracks = tracks.map(stripTrackForStorage);

  const store = await getKvStore();
  const folded = fold(trimmedName);
  const ttl = remainingTtlSeconds(openRecord.meta);

  // Tracks before the roster slot, so the two are never out of order in the way
  // that matters: a slot with no tracks yet would show the host a contributor
  // whose playlist cannot be pooled, whereas tracks with no slot are invisible
  // and expire on their own.
  await store.set(tracksKey(code, folded), strippedTracks, ttl);

  if (!(await store.hsetnx(roomKey(code), rosterField(trimmedName), {
    playerName: trimmedName,
    trackCount: strippedTracks.length,
    joinedAt: Date.now(),
  } satisfies RosterEntry))) {
    // Someone else holds this name. Not a retryable race any more — the field
    // is claimed and will stay claimed for the life of the room.
    await store.del(tracksKey(code, folded)).catch(() => {});
    throw new RoomError("room_name_taken", 409);
  }

  // One more read, for one question: did the host press Start while we were
  // fetching a playlist? Nothing else needs re-checking. The name is settled by
  // the claim above, and the size cap is deliberately not re-enforced here —
  // rolling a winner back because a simultaneous submit pushed the count over
  // would turn someone away who did arrive in time, and the alternative it
  // guards against is a room of thirteen instead of twelve.
  const after = await loadRoom(code);
  if (!after || after.consumedBy) {
    await store.hdel(roomKey(code), rosterField(trimmedName)).catch(() => {});
    await store.del(tracksKey(code, folded)).catch(() => {});
    throw after
      ? new RoomError("room_already_started", 410)
      : new RoomError("room_not_found", 404);
  }

  return { trackCount: tracks.length };
}

export async function getRoomStatus(code: string): Promise<RoomStatusResponse> {
  const room = await loadRoom(code);
  if (!room) throw new RoomError("room_not_found", 404);

  return {
    submissions: room.roster.map((entry) => ({
      playerName: entry.playerName,
      trackCount: entry.trackCount,
    })),
    total: room.roster.length,
    expiresAt: room.meta.expiresAt,
  };
}

export async function consumeRoomPool(
  code: string,
  sampledPerPlayer: number,
  hostToken: string
): Promise<RoomPoolResponse> {
  const store = await getKvStore();
  // Unique per call, not per room: identifies which of two concurrent
  // consumeRoomPool attempts (e.g. a double-tapped Start button) actually
  // won, so the loser gets a clean 410 instead of a second, differently
  // shuffled pool.
  const attemptId = randomUUID();

  const room = await requireOpenRoom(code);
  if (!timingSafeEqualStrings(room.meta.hostToken, hostToken)) {
    throw new RoomError("room_not_host", 403);
  }
  if (room.roster.length < 1) {
    throw new RoomError("room_no_submissions", 422);
  }

  // The whole race, decided by one command. Whoever writes `consumed` first
  // owns the pool; everyone else is told the game already started, which is
  // true. The old version wrote the flag and then re-read to find out whether
  // it had held, which could only ever narrow the window.
  if (!(await store.hsetnx(roomKey(code), CONSUMED_FIELD, attemptId))) {
    throw new RoomError("room_already_started", 410);
  }

  // Only now are the track lists worth fetching — one mget for the whole room,
  // rather than having dragged them along in every roster poll all evening.
  const lists = await store.mget<Track[]>(
    room.roster.map((entry) => tracksKey(code, entry.folded))
  );
  const submissions = room.roster
    .map((entry, i) => ({ playerName: entry.playerName, tracks: lists[i] ?? [] }))
    // A contributor whose tracks key is missing cannot be in the pool, and
    // listing them as a player would credit a contribution that is not there.
    .filter((s) => s.tracks.length > 0);

  if (submissions.length < 1) {
    // Every roster entry exists but none of their tracks do — an anomaly, since
    // the tracks are written before the slot that names them. Release the room
    // rather than leaving it consumed: claiming `consumed` is how the race is
    // decided, so it necessarily happens before this is knowable, and a host
    // whose Start failed should still have a room to press Start in.
    await store.hdel(roomKey(code), CONSUMED_FIELD).catch(() => {});
    throw new RoomError("room_no_submissions", 422);
  }

  return {
    tracks: poolContributions(submissions, sampledPerPlayer),
    players: submissions.map((s) => s.playerName),
    sampledPerPlayer,
  };
}

/** Constant-time comparison so wrong host-token guesses can't be timed. */
function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against a same-length buffer anyway so the failure path takes
    // roughly the same time as a length-matched mismatch.
    timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
