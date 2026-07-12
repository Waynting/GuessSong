/**
 * sessionStorage game payload — shared between the setup page (write)
 * and the game page (read). Pure functions, no browser APIs, so they
 * are unit-testable.
 */

import type { Track } from "@/types";
import type { PlaylistSource } from "@/lib/analytics";
import { DEFAULT_SAMPLED_PER_PLAYER } from "@/types/room";

export const GAME_STORAGE_KEY = "guesssong_game";

export type GameMode = "party" | "trial";

export interface GamePlayer {
  name: string;
  score: number;
}

/** Mixed Playlist Mode metadata — how the pool was assembled. */
export interface MixedPlaylistMeta {
  contributorNames: string[];
  sampledPerPlayer: number;
}

export interface GamePayload {
  tracks: Track[];
  players: GamePlayer[];
  playlistName: string;
  clipDuration: number;
  totalTracks: number;
  playlistSource: PlaylistSource;
  mode: GameMode;
  mixedPlaylistMeta?: MixedPlaylistMeta;
}

const PLAYLIST_SOURCES: PlaylistSource[] = ["own", "builtin", "mixed"];

function isPlaylistSource(value: unknown): value is PlaylistSource {
  return typeof value === "string" && (PLAYLIST_SOURCES as string[]).includes(value);
}

/**
 * Strip the bulky Spotify rawJson blob from a track before persisting.
 * Large playlists with rawJson can blow past the ~5MB sessionStorage cap.
 */
export function stripTrackForStorage(track: Track): Track {
  const rest = { ...track };
  delete rest.rawJson;
  return rest;
}

export interface BuildGamePayloadInput {
  tracks: Track[];
  players: GamePlayer[];
  playlistName: string;
  clipDuration: number;
  totalTracks?: number;
  playlistSource: PlaylistSource;
  mode: GameMode;
  mixedPlaylistMeta?: MixedPlaylistMeta;
}

export function buildGamePayload(input: BuildGamePayloadInput): GamePayload {
  return {
    tracks: input.tracks.map(stripTrackForStorage),
    players: input.players,
    playlistName: input.playlistName,
    clipDuration: input.clipDuration,
    totalTracks: input.totalTracks ?? input.tracks.length,
    playlistSource: input.playlistSource,
    mode: input.mode,
    ...(input.mixedPlaylistMeta ? { mixedPlaylistMeta: input.mixedPlaylistMeta } : {}),
  };
}

/**
 * Number of rounds actually played when a game ends. A round counts only
 * once its clip has started; ending during "waiting" means the current
 * round was never played. Keeps game_finished's rounds_played consistent
 * with the number of round_completed events and the trial "You got X / Y"
 * denominator.
 */
export function countRoundsPlayed(currentIndex: number, phase: string): number {
  return currentIndex + (phase === "waiting" ? 0 : 1);
}

/**
 * Parse a raw sessionStorage string into a GamePayload.
 * Returns null when the JSON is invalid or has no usable track list.
 * Old payloads (pre playlistSource/mode) get backward-compatible defaults.
 */
export function parseGamePayload(raw: string): GamePayload | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;

  const d = data as Record<string, unknown>;
  const tracks = Array.isArray(d.tracks) ? (d.tracks as Track[]) : [];
  const players = Array.isArray(d.players) ? (d.players as GamePlayer[]) : [];

  const rawMeta = d.mixedPlaylistMeta as Record<string, unknown> | undefined;
  const mixedPlaylistMeta: MixedPlaylistMeta | undefined =
    rawMeta && typeof rawMeta === "object" && Array.isArray(rawMeta.contributorNames)
      ? {
          contributorNames: rawMeta.contributorNames as string[],
          sampledPerPlayer:
            typeof rawMeta.sampledPerPlayer === "number"
              ? rawMeta.sampledPerPlayer
              : DEFAULT_SAMPLED_PER_PLAYER,
        }
      : undefined;

  return {
    tracks,
    players,
    playlistName: typeof d.playlistName === "string" ? d.playlistName : "",
    clipDuration: typeof d.clipDuration === "number" ? d.clipDuration : 15,
    totalTracks: typeof d.totalTracks === "number" ? d.totalTracks : tracks.length,
    playlistSource: isPlaylistSource(d.playlistSource) ? d.playlistSource : "own",
    mode: d.mode === "trial" ? "trial" : "party",
    ...(mixedPlaylistMeta ? { mixedPlaylistMeta } : {}),
  };
}
