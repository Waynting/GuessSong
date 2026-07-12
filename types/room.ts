import type { PooledTrack } from "@/lib/mixed-playlist";

/** Wire contract for the Mixed Playlist Mode room mailbox (/api/room/*). */

export const ROOM_CODE_LENGTH = 4;
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
