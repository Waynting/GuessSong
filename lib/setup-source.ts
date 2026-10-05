/**
 * The setup sources, in a module with no imports so the browser can hold them.
 *
 * They used to live in `lib/loop-stats.ts`, which imports `lib/kv.ts` and with
 * it the Upstash client. The game page needs the list at runtime now — it
 * reads the source back out of the stored game payload so the end and leave
 * beacons can carry it — and a runtime import of `lib/loop-stats.ts` from
 * `lib/game-session.ts` would put the KV client in the game page's bundle.
 * `lib/loop-stats.ts` re-exports both, so its callers did not move.
 */

/**
 * How the playlist a game started with got into the field.
 *
 *   typed     typed or pasted by hand — the only way in there was, bar the
 *             share target, before the form remembered anything
 *   restored  the form came back filled in from the last game on this device,
 *             and the host pressed Start without touching the link
 *   recent    a recent-playlist chip under the field
 *   starter   a starter chip (`lib/starter-playlists.ts`)
 *   shared    Android's share target, `/share` → `/?playlist=…`
 *   mixed     Mixed Playlist Mode, either route — there is no single link
 *
 * Exists because 56.5% of games in the week to 2026-09-29 came from a device
 * that had hosted before, every one of them retyped from an empty form, and
 * the form's memory was built on that number. This is what says whether the
 * memory is *used*: `restored + recent` is a returning host who did not
 * retype; `typed` from a repeat host is one whose storage was evicted (iOS,
 * seven idle days) or who wanted a different playlist tonight.
 *
 * Rides on `game_started` for the reason `MixedSubMode` does — it is a
 * property of the game that started, not a second thing that happened — and
 * lives here for the same reason too: these strings become the tail of a key.
 * A client that predates it sends none and is counted in `games` exactly as
 * before, so the six sum to at most `games`, never to it, in any window that
 * straddles the deploy.
 */
export type SetupSource = "typed" | "restored" | "recent" | "starter" | "shared" | "mixed";

export const SETUP_SOURCES: readonly SetupSource[] = [
  "typed",
  "restored",
  "recent",
  "starter",
  "shared",
  "mixed",
];

export function isSetupSource(value: unknown): value is SetupSource {
  return typeof value === "string" && (SETUP_SOURCES as readonly string[]).includes(value);
}
