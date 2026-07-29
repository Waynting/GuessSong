/**
 * Server-only room mailbox for Mixed Playlist Mode's QR submission flow (v1).
 * A room is a one-shot TTL'd inbox: players submit playlist URLs, the host
 * polls status, then pulls+consumes the pool once. No realtime sync needed —
 * polling is spec-approved (§4.2), so this stays on top of lib/kv.ts's KV
 * abstraction rather than a WebSocket room.
 */

import { randomUUID, timingSafeEqual } from "node:crypto";
import { getPlaylistWithTracks } from "@/lib/spotify";
import { poolContributions } from "@/lib/mixed-playlist";
import { getKvStore } from "@/lib/kv";
import { stripTrackForStorage } from "@/lib/game-session";
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

// submitToRoom/consumeRoomPool retry on a lost write race (see below) instead
// of overwriting blind — this bounds how many times they'll retry before
// giving up and telling the client to try again.
const MAX_WRITE_ATTEMPTS = 5;

interface RoomSubmission {
  playerName: string;
  tracks: Track[];
}

interface RoomRecord {
  code: string;
  hostToken: string;
  createdAt: number;
  expiresAt: number;
  consumed: boolean;
  /** Set only on the write that wins the consume race — see consumeRoomPool. */
  consumedBy?: string;
  submissions: RoomSubmission[];
}

export class RoomError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function roomKey(code: string): string {
  return `room:${code.toUpperCase()}`;
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

function remainingTtlSeconds(record: RoomRecord): number {
  return Math.max(1, Math.round((record.expiresAt - Date.now()) / 1000));
}

async function writeNewRoom(
  store: Awaited<ReturnType<typeof getKvStore>>,
  code: string
): Promise<{ roomCode: string; expiresAt: number; hostToken: string }> {
  const now = Date.now();
  const hostToken = randomUUID();
  const record: RoomRecord = {
    code,
    hostToken,
    createdAt: now,
    expiresAt: now + ROOM_TTL_SECONDS * 1000,
    consumed: false,
    submissions: [],
  };
  await store.set(roomKey(code), record, ROOM_TTL_SECONDS);
  return { roomCode: code, expiresAt: record.expiresAt, hostToken };
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
      throw new RoomError("Invalid room code", 422);
    }
    const existing = await store.get<RoomRecord>(roomKey(code));
    if (existing) {
      throw new RoomError("That room code is already in use", 409);
    }
    return writeNewRoom(store, code);
  }

  // Small retry loop for the unlikely event of a code collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    const existing = await store.get<RoomRecord>(roomKey(code));
    if (existing) continue;
    return writeNewRoom(store, code);
  }
  throw new RoomError("Could not allocate a room code, please try again", 500);
}

async function requireOpenRoom(code: string) {
  const store = await getKvStore();
  const record = await store.get<RoomRecord>(roomKey(code));
  if (!record) throw new RoomError("Room not found or expired", 404);
  if (record.consumed) throw new RoomError("This room has already started", 410);
  return { store, record };
}

/**
 * submitToRoom and consumeRoomPool both read-modify-write the whole room
 * record — there's no CAS primitive on lib/kv.ts's get/set. Two requests
 * landing close together (the common case for a QR-code room: a group
 * scanning and submitting within the same few seconds) can otherwise race:
 * both read the same base record, both write, and the loser's change is
 * silently dropped. Guard against that by re-reading the record immediately
 * before every write and verifying afterward that our own change actually
 * persisted; if a concurrent writer clobbered us, retry against the fresh
 * state instead of failing (or worse, succeeding) silently.
 */
export async function submitToRoom(
  code: string,
  playerName: string,
  playlistUrl: string
): Promise<{ trackCount: number }> {
  // Validate the room is currently open before doing the slow network work
  // below, so a request against a dead room fails fast.
  await requireOpenRoom(code);

  const trimmedName = playerName.trim();
  if (!trimmedName) throw new RoomError("Name is required", 422);

  let tracks: Track[];
  try {
    ({ tracks } = await getPlaylistWithTracks(playlistUrl));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load playlist";
    throw new RoomError(message, 422);
  }
  if (tracks.length < 1) {
    throw new RoomError("This playlist has no tracks", 422);
  }
  const strippedTracks = tracks.map(stripTrackForStorage);

  const store = await getKvStore();
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const fresh = await store.get<RoomRecord>(roomKey(code));
    if (!fresh) throw new RoomError("Room not found or expired", 404);
    if (fresh.consumed) throw new RoomError("This room has already started", 410);
    if (
      fresh.submissions.some(
        (s) => s.playerName.toLowerCase() === trimmedName.toLowerCase()
      )
    ) {
      throw new RoomError("That name is already taken in this room", 409);
    }
    if (fresh.submissions.length >= ROOM_MAX_SUBMISSIONS) {
      throw new RoomError("This room is full", 409);
    }

    const updated: RoomRecord = {
      ...fresh,
      submissions: [...fresh.submissions, { playerName: trimmedName, tracks: strippedTracks }],
    };
    await store.set(roomKey(code), updated, remainingTtlSeconds(updated));

    // Did our write survive, or did a concurrent submitToRoom overwrite it
    // with a copy that doesn't include us? Check for our own entry rather
    // than trusting the write call succeeded.
    const verify = await store.get<RoomRecord>(roomKey(code));
    const persisted = verify?.submissions.some(
      (s) => s.playerName.toLowerCase() === trimmedName.toLowerCase()
    );
    if (persisted) {
      return { trackCount: tracks.length };
    }
    // Lost the race — retry against whatever the winner left behind.
  }
  throw new RoomError("Room is busy, please try again", 409);
}

export async function getRoomStatus(code: string): Promise<RoomStatusResponse> {
  const store = await getKvStore();
  const record = await store.get<RoomRecord>(roomKey(code));
  if (!record) throw new RoomError("Room not found or expired", 404);

  return {
    submissions: record.submissions.map((s) => ({
      playerName: s.playerName,
      trackCount: s.tracks.length,
    })),
    total: record.submissions.length,
    expiresAt: record.expiresAt,
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
  // won the write race, so the loser gets a clean 410 instead of a second,
  // differently-shuffled pool.
  const attemptId = randomUUID();

  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const fresh = await store.get<RoomRecord>(roomKey(code));
    if (!fresh) throw new RoomError("Room not found or expired", 404);
    if (fresh.consumed) throw new RoomError("This room has already started", 410);
    if (!timingSafeEqualStrings(fresh.hostToken, hostToken)) {
      throw new RoomError("Only the room's host can start the game", 403);
    }
    if (fresh.submissions.length < 1) {
      throw new RoomError("No submissions yet", 422);
    }

    const tracks = poolContributions(
      fresh.submissions.map((s) => ({ playerName: s.playerName, tracks: s.tracks })),
      sampledPerPlayer
    );

    const updated: RoomRecord = { ...fresh, consumed: true, consumedBy: attemptId };
    await store.set(roomKey(code), updated, remainingTtlSeconds(updated));

    const verify = await store.get<RoomRecord>(roomKey(code));
    if (verify?.consumedBy === attemptId) {
      return {
        tracks,
        players: fresh.submissions.map((s) => s.playerName),
        sampledPerPlayer,
      };
    }
    // A concurrent consumeRoomPool call won — this room is now consumed by
    // them, so re-reading will hit the `fresh.consumed` guard above and
    // throw 410 on the next iteration.
  }
  throw new RoomError("Room is busy, please try again", 409);
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
