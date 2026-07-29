/**
 * One room, one code, one QR.
 *
 * There used to be two independent room systems and a game could end up using
 * both: a Mixed Playlist mailbox in Upstash (`lib/room.ts`, joined at `/j/`)
 * and a live buzzer Durable Object on Cloudflare (`worker/`, joined at
 * `/buzz/`). Turning Buzzer Mode on in Mixed Playlist Mode meant players
 * scanned twice, for two different codes, on two different pages.
 *
 * ## Why sharing one code is safe now, and wasn't before
 *
 * Sharing was rejected once for a real reason: the playlist code is shown to
 * every player, and the Worker hands its host token to whoever POSTs a code
 * first, so any guest could have claimed the buzzers.
 *
 * That dies if the host claims the Durable Object **first**:
 *
 *   1. `POST /rooms` on the Worker  → `{ code, hostToken }`
 *   2. `POST /api/room` with that same code → the Upstash mailbox
 *   3. only now is the code shown
 *
 * The code is never public before the host holds the DO, so there is nothing
 * left to race for. Keep those steps in that order — reversing them re-opens
 * the takeover.
 *
 * The two backends keep their own lifetimes on purpose: the mailbox is a
 * one-shot inbox consumed at kickoff, the DO slides its TTL and outlives it for
 * the whole game. Only the *code* is shared.
 */

import { buzzerJoinUrl, createBuzzerRoom } from "@/lib/buzzer-client";
import type { BuzzerRoomHandle } from "@/lib/game-session";

export interface OpenRoom {
  /** The single code players see, scan, and type. */
  code: string;
  /** True when this room also collects playlist submissions. */
  collectsPlaylists: boolean;
  /** Host secret for consuming the playlist pool. Set iff collectsPlaylists. */
  playlistHostToken?: string;
  /** Live buzzer handle. Set iff the room drives buzzers. */
  buzzer?: BuzzerRoomHandle;
}

export interface OpenRoomOptions {
  /** Collect playlist URLs from players (Mixed Playlist Mode's QR flow). */
  collectsPlaylists: boolean;
  /** Give every player a buzzer on their phone. */
  buzzer: boolean;
  /** What the host is called in the buzzer room. Ignored when buzzer is off. */
  hostName: string;
}

/**
 * Both code spaces are 4 characters from the same 31-character alphabet, so a
 * DO code landing on a live mailbox is a ~1-in-900k event. It is still worth
 * one retry rather than showing the host an error they can only fix by
 * pressing the same button again.
 */
const MAX_ATTEMPTS = 3;

export async function openRoom({
  collectsPlaylists,
  buzzer,
  hostName,
}: OpenRoomOptions): Promise<OpenRoom> {
  if (!collectsPlaylists && !buzzer) {
    throw new Error("A room needs at least one job to do");
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Step 1 — claim the Durable Object before the code exists anywhere else.
    const claimed = buzzer ? await createBuzzerRoom() : null;

    if (!collectsPlaylists) {
      // Buzzer only: nothing to reserve on the Next.js side.
      return {
        code: claimed!.code,
        collectsPlaylists: false,
        buzzer: { ...claimed!, hostName },
      };
    }

    // Step 2 — reserve the mailbox, under the claimed code when there is one.
    const res = await fetch("/api/room", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(claimed ? { code: claimed.code } : {}),
    });
    const data = await res.json();

    if (res.status === 409 && claimed) {
      // That code is already a live playlist room. Claim a different DO rather
      // than joining a stranger's mailbox. The abandoned DO is empty and ages
      // out on its own idle timer.
      continue;
    }
    if (!res.ok) {
      throw new Error(data.error || "Failed to open the room");
    }

    return {
      code: data.roomCode,
      collectsPlaylists: true,
      playlistHostToken: data.hostToken,
      ...(claimed ? { buzzer: { ...claimed, hostName } } : {}),
    };
  }

  throw new Error("Couldn't find a free room code, please try again");
}

/**
 * The URL players scan. Built from `window.location.origin`, never
 * `NEXT_PUBLIC_BASE_URL` — that points at production, so a Vercel preview would
 * otherwise print a QR sending everyone to a deployment where this room does
 * not exist.
 *
 * A buzzer room routes to `/buzz/` even when it also collects playlists, because
 * that page holds the live socket and the mailbox is a single POST it can make
 * on the side. `?p=1` tells it to ask for a playlist URL as well as a name; it
 * is a hint for the form, not a permission, so it needs no protecting.
 */
export function roomJoinUrl(room: OpenRoom): string {
  if (room.buzzer) {
    return `${buzzerJoinUrl(room.code)}${room.collectsPlaylists ? "?p=1" : ""}`;
  }
  const base =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_BASE_URL ?? "https://www.guessong.app";
  return `${base.replace(/\/$/, "")}/j/${room.code.toUpperCase()}`;
}

/** Query flag on a `/buzz/` link meaning "also ask this player for a playlist". */
export const JOIN_WANTS_PLAYLIST_PARAM = "p";

export interface RosterEntry {
  name: string;
  /** Socket presence. Undefined when there is no buzzer half to ask. */
  live?: boolean;
  /** Tracks submitted. Undefined when this player hasn't submitted (yet). */
  trackCount?: number;
}

/**
 * Merge the two rosters a unified room can report on: joined phones from the
 * live socket, and playlist submissions from the mailbox poll.
 *
 * Neither list contains the other. A phone can join the buzzer before adding a
 * playlist, and a player who submitted then closed the tab is gone from the
 * socket while still owing tracks to the pool — so both have to be walked, with
 * the live list first because it is the one that updates in real time.
 *
 * Matching is case-insensitive for the same reason `mergeRoomRoster` is: the
 * buzzer room refuses a second "amy" while "Amy" is connected, so two spellings
 * are one human reconnecting, not two players.
 */
export function buildRoster(
  phones: { name: string; connected: boolean }[],
  submissions: { playerName: string; trackCount: number }[],
  collectsPlaylists: boolean,
  hasBuzzer: boolean
): RosterEntry[] {
  const tracksByName = new Map(
    submissions.map((s) => [s.playerName.trim().toLowerCase(), s.trackCount])
  );

  const entries: RosterEntry[] = [];
  const seen = new Set<string>();

  if (hasBuzzer) {
    for (const p of phones) {
      const key = p.name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        name: p.name,
        live: p.connected,
        ...(collectsPlaylists ? { trackCount: tracksByName.get(key) } : {}),
      });
    }
  }

  if (collectsPlaylists) {
    for (const s of submissions) {
      const key = s.playerName.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ name: s.playerName, trackCount: s.trackCount });
    }
  }

  return entries;
}
