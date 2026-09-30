/**
 * What the game page knows about itself that its beacons need: whether this
 * device has hosted before, and whether this page is the first one this game
 * has had.
 *
 * Both are read once, on mount, and both degrade to "count it" when the
 * browser will not say — the direction `firstTimeThisSession` in
 * `lib/loop-client.ts` takes, for its reason: over-counting understates a
 * rate, and an understated rate cannot manufacture a success.
 */

import type { GameHostKind } from "@/lib/loop-stats";

/**
 * The host kind, from the stored game count (`getHostGameCount`).
 *
 * The start on `/` bumps the count before it navigates here, so on this page
 * the count *is* this game's 1-based index. That makes zero impossible for a
 * game that started normally — and so zero is the reading for "could not
 * tell": storage refused, the write never landed, or the count was evicted
 * between the two pages. It is never "first". Filing the unreadable under
 * `first` would put every locked-down browser into the bucket the question
 * is about.
 */
export function hostKindOf(hostGameCount: number): GameHostKind {
  if (!Number.isInteger(hostGameCount) || hostGameCount < 1) return "unknown";
  return hostGameCount === 1 ? "first" : "repeat";
}

const INSTANCE_KEY = "guesssong_game_page";

/**
 * A game's identity, as far as one tab can tell.
 *
 * The queue is shuffled on every Start, so its first few ids differ between
 * two games of the same playlist; the host's game count separates the rest.
 * Read from the queue as loaded, before anything is dropped from it — the
 * same game must fingerprint the same way after a reload.
 */
export function gameFingerprint(
  tracks: readonly { id: string }[],
  hostGameCount: number
): string {
  const head = tracks
    .slice(0, 3)
    .map((t) => t.id)
    .join(",");
  return `${hostGameCount}|${tracks.length}|${head}`;
}

/**
 * True when this is the first page this game has had; false for a reload.
 *
 * ## Why a reload has to be told apart
 *
 * The game payload in sessionStorage is the setup, not the progress, so a
 * reload is round one again — with no start beacon, because every
 * `game_started` call site is on the setup page. Left alone, the restarted
 * page would send its own first clip and its own leave, and one game in
 * `games` would put two entries, or five, into histograms whose whole reading
 * is their shape against `games`. And it would do it in the worst place: a
 * host whose game will not play is exactly the host who reloads, so the pile
 * at rounds zero and one would inflate in proportion to how broken the game
 * was.
 *
 * So the once-per-game beacons — the first clip and the leave — are sent by a
 * game's first page only. The reload itself is still in the numbers: it is
 * the first page's leave, at the round it happened. What a restarted page
 * does *not* lose is its end beacon, which is untouched by this and counts as
 * it always has.
 *
 * sessionStorage, because a game is a tab's: the marker has to survive a
 * reload and must not survive into another tab, and that is that storage's
 * contract. Guarded on the property access itself, for the reason
 * `lib/game-storage.ts` gives.
 */
export function claimFirstPage(storage: Storage | null, fingerprint: string): boolean {
  if (!storage) return true;
  try {
    if (storage.getItem(INSTANCE_KEY) === fingerprint) return false;
    storage.setItem(INSTANCE_KEY, fingerprint);
    return true;
  } catch {
    return true;
  }
}

/** `window.sessionStorage` when it can be touched at all, null otherwise. */
export function gamePageStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
