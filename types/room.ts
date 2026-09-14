import type { PooledTrack } from "@/lib/mixed-playlist";

/** Wire contract for the Mixed Playlist Mode room mailbox (/api/room/*). */

export const ROOM_CODE_LENGTH = 4;
/**
 * Excludes visually-confusable characters (0/O, 1/I/L) per spec §4.2. Shared
 * with the quiz's six-character codes (lib/quiz-store.ts), so a second alphabet
 * cannot quietly disagree about which characters a code may hold.
 */
export const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
/** How many random codes a store tries before giving up on a collision. */
export const CODE_CLAIM_ATTEMPTS = 5;
export const ROOM_TTL_SECONDS = 30 * 60;
export const ROOM_MAX_SUBMISSIONS = 12;
export const DEFAULT_SAMPLED_PER_PLAYER = 8;

export interface RoomSubmissionSummary {
  playerName: string;
  trackCount: number;
}

export interface CreateRoomResponse {
  roomCode: string;
  expiresAt: number;
  /** Secret held only by the creator; required to consume the room's pool. */
  hostToken: string;
}

export interface SubmitRoomRequest {
  playerName: string;
  playlistUrl: string;
}

export interface SubmitRoomResponse {
  ok: true;
  trackCount: number;
}

export interface RoomStatusResponse {
  submissions: RoomSubmissionSummary[];
  total: number;
  expiresAt: number;
}

export interface RoomPoolResponse {
  tracks: PooledTrack[];
  players: string[];
  sampledPerPlayer: number;
}
