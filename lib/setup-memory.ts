/**
 * What the setup form remembers between parties, and how it is read back.
 *
 * ## Why it exists
 *
 * In the week to 2026-09-29, 56.5% of games were started from a device that
 * had hosted before — and that is a floor, for the reasons at the top of
 * `lib/host-session.ts`. Every one of them arrived at an empty form: the Game
 * Over screen's "Play Again" goes to `/`, and `/` opened on `useState("")`. A
 * host running their fifth evening pasted the same link and typed the same
 * six names a fifth time. The only things the device kept were a counter and
 * an attribution, both of them for us.
 *
 * ## What is kept, and what is not
 *
 * Two keys, both in `localStorage`, both per device and never per person:
 *
 *   - **the last setup** — the link and name of the last single playlist that
 *     loaded, the player names, clip length, song count, the play style
 *     (guess the song, or put them in order) and the three switches a host
 *     would otherwise have to find again (mode, Mixed's sub-mode, the
 *     buzzer) plus Mixed's songs-per-player.
 *   - **recent playlists** — the last five that loaded, newest first.
 *
 * Written when a game actually starts — the three `recordHostedStart` call
 * sites in `app/page.tsx` — and never while typing. A link is only worth
 * remembering once it has loaded, which is also the only moment its *name* is
 * known; and a form that saved every keystroke would restore a half-typed
 * name as though it were a player.
 *
 * Deliberately not kept: a Mixed game's contributors. Those are other
 * people's names and other people's playlists, typed into a phone that was
 * passed around, and none of them agreed to be on it next week. Nor the room:
 * a code is spent when its game starts.
 *
 * Nothing here is sent anywhere. `/privacy` says so, in both languages, and
 * `tests/site-policy.test.ts` pins that it goes on saying so.
 *
 * ## Everything read back is repaired, never trusted and never rejected
 *
 * The same rule `parseGamePayload` follows, for the same reason: what comes
 * out of storage was written by an older deploy or edited by hand, and it is
 * read in a mount effect on the page that takes nearly all of the site's
 * traffic. So each field is validated on its own and falls back to the form's
 * default on its own — a clip length that is no longer offered snaps to the
 * nearest one that is, an unknown mode reads as Single — and one bad field
 * never costs the host the other eight. Nothing here throws, and storage is
 * only ever touched through `lib/host-session.ts`, which is what makes that
 * true in a browser that throws on the property access itself.
 */

import { readStored, removeStored, writeStored } from "@/lib/host-session";
// Types only. `lib/loop-stats.ts` imports `lib/kv.ts`, and a value import from
// it here would carry the Upstash client into the setup page's bundle — which
// is why the sub-mode allow-list below is a `Record` the compiler checks
// against the union rather than `MIXED_SUB_MODES` itself.
import type { MixedSubMode, SetupSource } from "@/lib/loop-stats";
import { isEditorialId, isPlaylistId, playlistIdOf, playlistUrlOf } from "@/lib/playlist-ref";
import type { RequestedSetupMode } from "@/lib/setup-arrival";
import {
  DEFAULT_SONG_COUNT_STATE,
  clampSongCount,
  isSongCountPreset,
  selectPreset,
  type SongCountState,
} from "@/lib/song-count";
import { SETUP_MODES, type SetupMode } from "@/lib/start-status";
import { DEFAULT_PLAY_STYLE, isPlayStyle, type PlayStyle } from "@/lib/order-game";
import { DEFAULT_SAMPLED_PER_PLAYER } from "@/types/room";

export const SETUP_MEMORY_KEY = "guesssong_last_setup";
export const RECENT_PLAYLISTS_KEY = "guesssong_recent_playlists";

/**
 * The clip lengths the form offers, in the order the pills render. Declared
 * here rather than in `app/page.tsx` because the validator below has to agree
 * with the pills about what is on offer, and two lists would let a remembered
 * length select a pill that is not there.
 */
export const CLIP_DURATIONS: readonly number[] = [5, 10, 15, 20, 30];
export const DEFAULT_CLIP_DURATION = 15;

/** Mixed mode's songs-per-player pills. Here for the same reason. */
export const MIXED_SAMPLE_COUNTS: readonly number[] = [5, 8, 10, 12];

/** The name fields' `maxLength`. The form reads it from here. */
export const PLAYER_NAME_MAX = 24;

/**
 * How many names are read back. The form itself has no ceiling — Add Player
 * can be pressed all evening — so this is not a rule about parties; it bounds
 * what a hand-edited entry can make the page render. Far enough above any
 * roster typed by hand that a real one is never cut short.
 */
export const REMEMBERED_PLAYERS_MAX = 24;

/**
 * A bound, not a rule about playlists: far longer than a chip shows before it
 * is cut with an ellipsis, and here only so a hand-edited entry cannot put a
 * megabyte of text on a button.
 */
export const PLAYLIST_NAME_MAX = 100;

export const RECENT_PLAYLISTS_MAX = 5;

/** The form opens with this many empty name fields, remembered roster or not. */
export const DEFAULT_PLAYER_ROWS = 2;

/** The link sources a single playlist can have. `mixed` has no single link. */
export type LinkSource = Exclude<SetupSource, "mixed">;

export interface RememberedSetup {
  /** Canonical address of the last single playlist that loaded, or "". */
  playlistUrl: string;
  /** Its name as Spotify gave it, or "" when there is no link. */
  playlistName: string;
  /** Trimmed, non-empty, at most `REMEMBERED_PLAYERS_MAX`. May be empty. */
  players: string[];
  clipDuration: number;
  songCount: number | "all";
  mode: SetupMode;
  mixedSubMode: MixedSubMode;
  sampledPerPlayer: number;
  buzzer: boolean;
  /** Guess the song, or put them in order (`lib/order-game.ts`). */
  playStyle: PlayStyle;
}

export interface RecentPlaylist {
  id: string;
  name: string;
}

function isSetupMode(value: unknown): value is SetupMode {
  return typeof value === "string" && (SETUP_MODES as readonly string[]).includes(value);
}

/**
 * Keyed by the union so that a third sub-mode is a compile error here until it
 * is listed. Read with `hasOwnProperty` for two reasons: `in` would take
 * `"constructor"` out of a hand-edited entry for a sub-mode, and
 * `Object.hasOwn` does not exist before Safari 15.4 or Chrome 93 — this runs
 * in the setup page's mount effect, and a missing function there is the crash
 * screen on exactly the phones `mintPlayerId` had to be rewritten for.
 */
const MIXED_SUB_MODE_SET: Record<MixedSubMode, true> = { room: true, phone: true };

function isMixedSubMode(value: unknown): value is MixedSubMode {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(MIXED_SUB_MODE_SET, value)
  );
}

/**
 * Trimmed, and cut to `max` UTF-16 units — the unit `maxLength` counts in —
 * without ever cutting a character in half.
 *
 * `slice` would: it counts the same units and is happy to stop between the
 * two halves of an emoji, leaving a lone surrogate in a name that then goes
 * into the game payload and onto the scoreboard. `for…of` walks code points,
 * so a character either fits whole or is left off. Same hazard, same fix, as
 * `clampPreviewField` in `types/preview.ts`.
 */
function clampText(value: string, max: number): string {
  let out = "";
  for (const char of value.trim()) {
    if (out.length + char.length > max) break;
    out += char;
  }
  return out;
}

/**
 * The offered value closest to what was stored, or the default when what was
 * stored is not a number at all.
 *
 * Nearest rather than "in the list or else the default" because the list is
 * allowed to change. A host who always plays 30-second clips, on the deploy
 * that stops offering 30, should come back to 20 — the closest thing to what
 * they chose — and not to a 15 they never picked. A tie goes to the shorter
 * one, which is the direction that costs a party less if it is wrong.
 */
function nearestOffered(offered: readonly number[], value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  let best = offered[0] ?? fallback;
  for (const option of offered) {
    if (Math.abs(option - value) < Math.abs(best - value)) best = option;
  }
  return best;
}

/**
 * The stored count through `lib/song-count.ts`'s own rule for a field the
 * host has finished with — `clampSongCount`, the one that pulls an
 * out-of-range number to the nearest end. Reading storage is a commit, not a
 * keystroke: there is no half-typed number to protect, so the per-keystroke
 * rule (reject) would be the wrong one of the two.
 */
function readSongCount(value: unknown): number | "all" {
  if (value === "all") {
    return isSongCountPreset("all") ? "all" : DEFAULT_SONG_COUNT_STATE.count;
  }
  if (typeof value !== "number" && typeof value !== "string") {
    return DEFAULT_SONG_COUNT_STATE.count;
  }
  return clampSongCount(String(value)) ?? DEFAULT_SONG_COUNT_STATE.count;
}

function readPlayers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const players: string[] = [];
  for (const entry of value) {
    if (players.length >= REMEMBERED_PLAYERS_MAX) break;
    if (typeof entry !== "string") continue;
    const name = clampText(entry, PLAYER_NAME_MAX);
    if (name) players.push(name);
  }
  return players;
}

/**
 * One record, every field repaired on its own.
 *
 * The link is rebuilt from its id rather than kept as stored: whatever the
 * string in storage says, what reaches the field is
 * `https://open.spotify.com/playlist/<22 characters>` or nothing. A name with
 * no link is dropped with it — it would be the name of nothing.
 */
export function normalizeSetup(data: Record<string, unknown>): RememberedSetup {
  const id = typeof data.playlistUrl === "string" ? playlistIdOf(data.playlistUrl) : null;
  const playlistUrl = isPlaylistId(id) ? playlistUrlOf(id) : "";
  return {
    playlistUrl,
    playlistName:
      playlistUrl && typeof data.playlistName === "string"
        ? clampText(data.playlistName, PLAYLIST_NAME_MAX)
        : "",
    players: readPlayers(data.players),
    clipDuration: nearestOffered(CLIP_DURATIONS, data.clipDuration, DEFAULT_CLIP_DURATION),
    songCount: readSongCount(data.songCount),
    mode: isSetupMode(data.mode) ? data.mode : "single",
    mixedSubMode: isMixedSubMode(data.mixedSubMode) ? data.mixedSubMode : "room",
    sampledPerPlayer: nearestOffered(
      MIXED_SAMPLE_COUNTS,
      data.sampledPerPlayer,
      DEFAULT_SAMPLED_PER_PLAYER
    ),
    // Strictly `true`. "true", 1 and {} are all truthy, and the buzzer is the
    // one switch here that hides part of the form when it is on.
    buzzer: data.buzzer === true,
    playStyle: isPlayStyle(data.playStyle) ? data.playStyle : DEFAULT_PLAY_STYLE,
  };
}

/**
 * Null for "nothing remembered" — no entry, or one that is not a record at
 * all. Anything that *is* a record comes back whole, defaults filling whatever
 * was missing or wrong.
 */
export function parseSetupMemory(raw: string | null): RememberedSetup | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  return normalizeSetup(data as Record<string, unknown>);
}

/**
 * What to store after a game starts: what was already remembered, with this
 * game's fields over it.
 *
 * A merge and not a replacement, because the three start paths each know a
 * different part of the form. A Mixed game has no single link and no typed
 * roster, and a buzzer game hides the roster it did not use — replacing the
 * record from either would forget the playlist and the names the host will
 * want back the next time they play the ordinary way.
 */
export function mergeSetup(
  existing: RememberedSetup | null,
  update: Partial<RememberedSetup>
): RememberedSetup {
  return normalizeSetup({ ...(existing ?? {}), ...update });
}

/**
 * Newest first, one entry per playlist, at most `RECENT_PLAYLISTS_MAX`.
 *
 * An entry needs an id of the right shape and a name to put on its chip; one
 * of Spotify's own ids is dropped too — it cannot have loaded, so it did not
 * get here by being played, and a chip for it is a chip that leads to a
 * refusal.
 */
export function parseRecentPlaylists(raw: string | null): RecentPlaylist[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];

  const seen = new Set<string>();
  const recent: RecentPlaylist[] = [];
  for (const entry of data) {
    if (recent.length >= RECENT_PLAYLISTS_MAX) break;
    if (typeof entry !== "object" || entry === null) continue;
    const { id, name } = entry as Record<string, unknown>;
    if (!isPlaylistId(id) || isEditorialId(id) || seen.has(id)) continue;
    if (typeof name !== "string") continue;
    const label = clampText(name, PLAYLIST_NAME_MAX);
    if (!label) continue;
    seen.add(id);
    recent.push({ id, name: label });
  }
  return recent;
}

/**
 * The list with a playlist that has just loaded at the front of it.
 *
 * Keyed by id, so the same playlist pasted with two different `?si=` tokens —
 * which is every time it is shared twice — is one chip that moves to the
 * front, and takes its current name with it: playlists get renamed. Returns
 * the list unchanged when the link has no storable id or the name is blank,
 * rather than inventing a label.
 */
export function addRecentPlaylist(
  list: readonly RecentPlaylist[],
  loaded: { url: unknown; name: unknown }
): RecentPlaylist[] {
  // `unknown`, and checked: both arrive from the page, and the name arrives
  // there out of a response body the compiler took on trust.
  const id = typeof loaded.url === "string" ? playlistIdOf(loaded.url) : null;
  const name = typeof loaded.name === "string" ? clampText(loaded.name, PLAYLIST_NAME_MAX) : "";
  if (!isPlaylistId(id) || isEditorialId(id) || !name) return [...list];
  return [{ id, name }, ...list.filter((p) => p.id !== id)].slice(0, RECENT_PLAYLISTS_MAX);
}

/**
 * The chips to show: the recent list, with the remembered playlist in it.
 *
 * It nearly always is already — the two are written one after the other, by
 * the same start. But they are two keys and two writes, and a browser at its
 * quota can keep one and refuse the other. Without this, that host comes back
 * to a field holding 22 characters of base62 and no chip lit to say which
 * playlist it is; the name kept with the setup is what fills the gap.
 */
export function chipsFor(
  recent: readonly RecentPlaylist[],
  remembered: RememberedSetup | null
): RecentPlaylist[] {
  const id = remembered ? playlistIdOf(remembered.playlistUrl) : null;
  if (!remembered || !isPlaylistId(id) || isEditorialId(id) || !remembered.playlistName) {
    return [...recent];
  }
  // Already listed: the list's order and its name for the playlist stand.
  if (recent.some((p) => p.id === id)) return [...recent];
  // Missing: it goes first, because it is the one that was played last.
  return [{ id, name: remembered.playlistName }, ...recent].slice(0, RECENT_PLAYLISTS_MAX);
}

/** The count as the control's state: a pill when it has one, the typed field when not. */
export function songCountStateOf(count: number | "all"): SongCountState {
  return isSongCountPreset(count) ? selectPreset(count) : { count, field: String(count) };
}

/** What the URL asked for, as far as the form is concerned. */
export interface SetupArrival {
  /** `?playlist=` from the share target, or null. */
  sharedUrl: string | null;
  /** `requestedSetupMode(query)`. */
  requestedMode: RequestedSetupMode | null;
}

/** Every piece of form state a restore can set. */
export interface SetupForm {
  setupMode: SetupMode;
  mixedSubMode: MixedSubMode;
  playlistUrl: string;
  /** How `playlistUrl` got there — the `setup_source` of a game started on it untouched. */
  linkSource: LinkSource;
  players: string[];
  clipDuration: number;
  songCount: SongCountState;
  sampledPerPlayer: number;
  buzzer: boolean;
  playStyle: PlayStyle;
}

/**
 * The form a visitor should be looking at, given what the URL asked for and
 * what the device remembers.
 *
 * **What the URL says outranks what the device remembers**, in both places the
 * two can disagree:
 *
 *   - a `?playlist=` arrival is someone who pressed Share on a playlist in
 *     Spotify a second ago. That link goes in the field, not last week's — and
 *     the form opens on Single, because the field it fills is not on screen in
 *     Mixed and a share that lands on a form with nowhere to put it reads as a
 *     share that did nothing.
 *   - a `?mode=mixed` arrival opens on Mixed, whatever was played last.
 *
 * Everything the URL is silent about comes from memory, and everything memory
 * is silent about is the form's default — so with `remembered` null and an
 * empty arrival this returns exactly the form the page has always opened on.
 * That is also what "Start fresh" applies: this function with the memory
 * taken away, which is why a fresh start on a shared link keeps the link.
 */
export function initialSetup(
  arrival: SetupArrival,
  remembered: RememberedSetup | null
): SetupForm {
  const shared = arrival.sharedUrl?.trim() ? arrival.sharedUrl : null;
  const names = remembered?.players ?? [];
  const blanks = Math.max(0, DEFAULT_PLAYER_ROWS - names.length);

  let setupMode: SetupMode = remembered?.mode ?? "single";
  if (shared) setupMode = "single";
  if (arrival.requestedMode === "mixed") setupMode = "mixed";

  const restoredUrl = remembered?.playlistUrl ?? "";
  const playStyle = remembered?.playStyle ?? DEFAULT_PLAY_STYLE;
  return {
    setupMode,
    mixedSubMode: remembered?.mixedSubMode ?? "room",
    playlistUrl: shared ?? restoredUrl,
    linkSource: shared ? "shared" : restoredUrl ? "restored" : "typed",
    players: [...names, ...Array.from({ length: blanks }, () => "")],
    clipDuration: remembered?.clipDuration ?? DEFAULT_CLIP_DURATION,
    songCount: remembered
      ? songCountStateOf(remembered.songCount)
      : DEFAULT_SONG_COUNT_STATE,
    sampledPerPlayer: remembered?.sampledPerPlayer ?? DEFAULT_SAMPLED_PER_PLAYER,
    // The buzzer has no round to buzz in when the cards are the game, and
    // the page hides its toggle in that style — so a record that says both
    // (one deploy's "order" over an older "buzzer: true") restores a form
    // whose roster is hidden behind a room nothing can open. The style wins.
    buzzer: playStyle === "order" ? false : (remembered?.buzzer ?? false),
    playStyle,
  };
}

/** The remembered setup, or null on a device that has none it can read. */
export function recallSetup(): RememberedSetup | null {
  return parseSetupMemory(readStored(SETUP_MEMORY_KEY));
}

/**
 * Call where a game starts, with the part of the form that start path knows.
 *
 * **Must never throw, and the `try` is what says so.** Both writers run
 * between `saveGame` and `router.push("/game")`, inside the `try` whose
 * `catch` reports a failed playlist. Everything under them is already
 * guarded — but a throw here, from anything, would land in that `catch`
 * after the game had been stored and counted, and tell a host whose playlist
 * loaded that it had not. That is the `storage_blocked` mistake in a new
 * place, on the one path every game takes. A browser that refuses the write
 * has cost the host a convenience next week and nothing tonight, so there is
 * nothing to report and nothing is.
 */
export function rememberSetup(update: Partial<RememberedSetup>): void {
  try {
    writeStored(SETUP_MEMORY_KEY, JSON.stringify(mergeSetup(recallSetup(), update)));
  } catch {
    // Not remembered. The game starts regardless.
  }
}

export function recallRecentPlaylists(): RecentPlaylist[] {
  return parseRecentPlaylists(readStored(RECENT_PLAYLISTS_KEY));
}

/**
 * Call once a single playlist has loaded and its game is starting. `unknown`
 * because the name is whatever the response body held. Never throws, for the
 * reason above.
 */
export function rememberPlaylist(url: unknown, name: unknown): void {
  try {
    const next = addRecentPlaylist(recallRecentPlaylists(), { url, name });
    if (next.length > 0) writeStored(RECENT_PLAYLISTS_KEY, JSON.stringify(next));
  } catch {
    // Not remembered. The game starts regardless.
  }
}

/**
 * Forget the setup and the recent playlists — "Start fresh".
 *
 * Both keys, because both are the previous host's: a laptop passed around a
 * room is several hosts, and clearing the form while leaving five chips named
 * after someone else's playlists under it would be forgetting half of them.
 *
 * It must NOT grow to clear `guesssong_host_games` or `guesssong_loop_ref`.
 * Those are not the host's data, they are the instruments: a control on the
 * busiest page of the site that resets the game counter would turn every
 * tidy-minded repeat host back into a first-timer, and the one number the
 * loop is judged on would fall for a reason nothing in `npm run stats` could
 * show.
 */
export function forgetSetup(): void {
  removeStored(SETUP_MEMORY_KEY);
  removeStored(RECENT_PLAYLISTS_KEY);
}
