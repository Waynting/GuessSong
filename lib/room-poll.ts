/**
 * When the Mixed Playlist Mode roster poll is allowed to ask again.
 *
 * This is policy, not plumbing, and it lives here rather than inside
 * `components/room-panel.tsx` for the reason `lib/analytics.ts` gives about its
 * own param helpers: the test suite only reaches `lib/`. Left in the component
 * these rules were unreachable by any test, and they are the rules that decide
 * how much of the Upstash budget an idle browser tab spends.
 *
 * The poll runs every `ROOM_POLL_INTERVAL_MS` and costs two Upstash commands a
 * tick — the route's rate-limit `incr`, then the room read. Unbounded, that is
 * ~15 requests a minute per open tab forever: ~43k commands a day against a
 * plan of 500k a *month*, and a spent quota fails every KV command for days
 * (see `docs/operations.md` §5). Nothing about the leak is visible on screen,
 * which is why it has to be visible in a test instead.
 */

/** How long a tick waits before asking again. */
export const ROOM_POLL_INTERVAL_MS = 4000;

/**
 * What a tick should do, decided before any request goes out.
 *
 * - `fetch` — ask now.
 * - `skip`  — do not ask, but stay scheduled. A background tab still fires
 *   timers; skipping the request is the entire saving, and the loop has to
 *   survive so the roster refreshes when the tab comes back.
 * - `stop`  — tear the loop down for good.
 */
export type PollTickAction = "fetch" | "skip" | "stop";

export interface PollTickInput {
  /** `Date.now()` at the tick. */
  now: number;
  /** Wall-clock time the room expires — `ROOM_TTL_SECONDS` from when it opened. */
  deadline: number;
  /** Whether the document is currently visible. */
  visible: boolean;
}

/**
 * The deadline is checked *before* the fetch, not after, so the last tick of a
 * room's life does not spend a request discovering that it expired — the
 * server would answer 404, which is exactly what the deadline already knows.
 */
export function pollTickAction({ now, deadline, visible }: PollTickInput): PollTickAction {
  if (now >= deadline) return "stop";
  return visible ? "fetch" : "skip";
}

/**
 * Whether the loop may ask again after a reply carrying `status`.
 *
 * 404 is a room that expired or never existed, 410 one that has already been
 * consumed by the host pressing Start. Both are terminal: nothing the host can
 * do on this screen brings that room back, so every later poll is a request
 * that can only be refused the same way. Swallowing them and retrying forever
 * is how an abandoned tab kept billing us for a room that no longer existed.
 *
 * Everything else keeps the loop alive on purpose, including the failures.
 * A 429 means our own limiter is throttling and will stop; a 500 may be the KV
 * outage documented in `docs/operations.md` §5, which ends when the quota rolls
 * over. Treating either as terminal would silently kill the roster on a party
 * that is about to work again — the mirror of the mistake in
 * `isDeterministicPlaylistFailure`, where "we don't know" must not harden into
 * "don't ask".
 */
export function canPollAgainAfter(status: number): boolean {
  return status !== 404 && status !== 410;
}
