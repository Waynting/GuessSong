/**
 * When the Mixed Playlist Mode roster poll is allowed to ask again.
 *
 * This is policy, not plumbing, and it lives here rather than inside
 * `components/room-panel.tsx` for the reason `lib/analytics.ts` gives about its
 * own param helpers: the test suite only reaches `lib/`. Left in the component
 * these rules were unreachable by any test, and they are the rules that decide
 * how much of the Upstash budget an idle browser tab spends.
 *
 * The poll costs two Upstash commands a tick — the route's rate-limit `incr`,
 * then the room read. Unbounded at `ROOM_POLL_INTERVAL_MS`, that is ~15
 * requests a minute per open tab forever: ~43k commands a day against a plan of
 * 500k a *month*, and a spent quota fails every KV command for days (see
 * `docs/operations.md` §5). Nothing about the leak is visible on screen, which
 * is why it has to be visible in a test instead.
 *
 * Two rules share that job. `pollTickAction` decides *whether* to ask, and
 * bounds the total; `pollIntervalMs` decides how long to wait, and bounds the
 * rate. The second exists because the first still allowed a lobby nobody has
 * touched in twenty minutes to poll as hard as one filling up.
 */

/**
 * The fast rung: how long a tick waits while the roster is still moving.
 *
 * Unchanged, and deliberately so — this is the interval a host actually
 * experiences, because every arrival resets the ladder back to it.
 */
export const ROOM_POLL_INTERVAL_MS = 4000;

/** After this long with nobody new, the roster is no longer filling. */
export const ROOM_POLL_SLOW_AFTER_MS = 60 * 1000;
export const ROOM_POLL_SLOW_INTERVAL_MS = 8000;

/** After this long, the tab is parked rather than being watched. */
export const ROOM_POLL_IDLE_AFTER_MS = 5 * 60 * 1000;
export const ROOM_POLL_IDLE_INTERVAL_MS = 20 * 1000;

/**
 * How long to wait before the next tick, given how long the roster has been
 * still.
 *
 * A flat four seconds spends the same 30 commands a minute on a lobby filling
 * up as on one nobody has touched since it opened, and the second case is the
 * common one: a host opens the room, everyone scans within the first minute or
 * two, and then the tab sits there until the game starts. Over a full
 * `ROOM_TTL_SECONDS` that flat interval is 450 ticks — 900 Upstash commands for
 * a room whose roster stopped changing in minute two.
 *
 * The ladder costs nothing where it matters. Every arrival resets the clock, so
 * a room that is actively filling polls at exactly the old interval throughout;
 * the slow rungs are only reachable by a stretch of silence, and the longest
 * one needs five unbroken minutes of it. Coming back to a backgrounded tab
 * polls immediately (`visibilitychange` in components/room-panel.tsx), so the
 * worst case is bounded by "the host is looking at the screen and nothing has
 * happened for five minutes" — at which point a 20-second refresh is not what
 * they are waiting on.
 *
 * Pure, and here rather than in the component, for the reason the file header
 * gives: this is the rule that decides the bill, and in the component nothing
 * could test it.
 */
export function pollIntervalMs(msSinceLastChange: number): number {
  // A NaN or negative reading means the caller lost track of when the roster
  // last moved. Treat that as "just now" — erring towards the fast rung costs
  // commands, erring the other way costs a host watching a stale screen.
  if (!Number.isFinite(msSinceLastChange) || msSinceLastChange < ROOM_POLL_SLOW_AFTER_MS) {
    return ROOM_POLL_INTERVAL_MS;
  }
  if (msSinceLastChange < ROOM_POLL_IDLE_AFTER_MS) return ROOM_POLL_SLOW_INTERVAL_MS;
  return ROOM_POLL_IDLE_INTERVAL_MS;
}

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
