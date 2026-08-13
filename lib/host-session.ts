/**
 * The two things a device remembers between parties: how many games it has
 * hosted, and which loop surface brought it here.
 *
 * Both live in `localStorage` and both are per-device, never per-person. There
 * are no accounts and there will not be — the whole product works because a
 * host pastes a link and starts, and anything that asks for a login is a worse
 * product. So this is the cheapest identity that answers "did anyone come
 * back", and it is deliberately not a user id: nothing here is sent anywhere
 * that could join it to a person.
 *
 * ## Read every number here as a floor
 *
 * iOS evicts script-writable storage after seven days without a visit, which
 * is precisely the gap between two parties. Private windows start empty. A
 * laptop passed around a room is several hosts wearing one identity. So a low
 * repeat-host figure is not evidence that nobody came back — it is the sum of
 * "did not come back" and "came back and we could not tell". Only the upward
 * direction of this number means anything.
 */

const GAMES_KEY = "guesssong_host_games";
const REF_KEY = "guesssong_loop_ref";

/**
 * How long a loop click keeps crediting a later game.
 *
 * The conversion this measures is not same-session. Someone taps "host the
 * next one" on a friend's sofa, and then hosts their own party a fortnight
 * later — attributing only within the pageview would record that as organic
 * and report the loop as dead. Sixty days is past any realistic gap while
 * still being short enough that a credit does not outlive its own cause.
 */
export const LOOP_REF_TTL_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * Every read and write goes through here.
 *
 * `app/page.tsx` is statically prerendered, so this module is evaluated during
 * the build where `window` does not exist — same guard, same reason, as
 * `getPersistentPlayerId` in `lib/use-buzzer-socket.ts`. Storage also throws
 * rather than returning null in a locked-down browser (Safari with cookies
 * blocked, some embedded webviews), and a party host is not going to debug
 * that, so every path swallows and degrades.
 */
function withStorage<T>(fn: (storage: Storage) => T, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    return fn(window.localStorage);
  } catch {
    return fallback;
  }
}

/** Games this device has hosted so far. 0 before the first one. */
export function getHostGameCount(): number {
  return withStorage((storage) => {
    const raw = storage.getItem(GAMES_KEY);
    // Digits only, deliberately stricter than `parseInt`, which is lenient in
    // ways that matter here: it reads "12abc" as 12 and "1e309" as 1, so a
    // corrupted value would come back looking like a plausible count instead
    // of like corruption. A hand-edited or half-written entry reads as a fresh
    // device, which is the safe direction — it undercounts repeat hosting
    // rather than inventing it.
    if (!raw || !/^\d+$/.test(raw)) return 0;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
  }, 0);
}

/**
 * Records that a hosted game is starting and returns its 1-based index.
 *
 * No idempotency token, on purpose. The two ways this could double-count are
 * both already closed: the Start button is disabled for the whole async
 * playlist load (`app/page.tsx`, `disabled={loading || roomStarting}`), and
 * reloading `/game` cannot re-fire it because every `game_started` call site
 * lives on the setup page and runs immediately before the navigation. The one
 * path that *does* reach here twice — "Play again", which routes back through
 * setup — is a genuine second game and must count as one.
 *
 * Only paths that start a real party call this. Anything that is one person
 * trying the app must stay out: counting it as hosting would inflate the only
 * number that answers whether anyone comes back.
 */
export function bumpHostGameCount(): number {
  return withStorage((storage) => {
    const next = getHostGameCount() + 1;
    storage.setItem(GAMES_KEY, String(next));
    return next;
  }, 1);
}

interface StoredRef {
  surface: string;
  at: number;
}

/** Remembers the loop surface a visitor arrived from, for a later game. */
export function rememberLoopRef(surface: string, now = Date.now()): void {
  withStorage((storage) => {
    const entry: StoredRef = { surface, at: now };
    storage.setItem(REF_KEY, JSON.stringify(entry));
  }, undefined);
}

/**
 * The remembered surface, or null once it has aged out.
 *
 * Last touch rather than first: a visitor who came in through the loop, then
 * returned by search, then came through the loop again is credited to the most
 * recent loop click. Organic visits in between do not clear it — they are how
 * people normally return, and treating them as a reset would erase the loop's
 * contribution from exactly the users it worked on.
 */
export function recallLoopRef(now = Date.now()): string | null {
  return withStorage((storage) => {
    const raw = storage.getItem(REF_KEY);
    if (!raw) return null;
    try {
      const entry = JSON.parse(raw) as Partial<StoredRef>;
      if (typeof entry?.surface !== "string") return null;
      if (typeof entry?.at !== "number" || !Number.isFinite(entry.at)) {
        return null;
      }
      if (now - entry.at > LOOP_REF_TTL_MS) return null;
      // A clock that jumped backwards would otherwise keep a stale credit
      // alive indefinitely.
      if (entry.at > now + 24 * 60 * 60 * 1000) return null;
      return entry.surface;
    } catch {
      return null;
    }
  }, null);
}
