/**
 * The setup page's own recheck of a private refusal, sent once, half a minute
 * after the refusal, without the host pressing anything.
 *
 * ## Why it exists
 *
 * Spotify's API keeps answering 404 for a playlist for a while after it is
 * made public, and flaps between 404 and 200 inside that window. Watched live
 * on 2026-10-16: 18 of 38 "private or deleted" refusals were already public,
 * tracks and all, within seconds of the 404 we cached, and three times the
 * server got a fresh 404 after the playlist had been seen public. Most of
 * those hosts pressed "I made it public — try again" and got in a minute or
 * two later; two never asked again and left with a playlist that worked.
 * This asks for them.
 *
 * ## The rules
 *
 * - **Asked at most once per link per page, never a loop.** It is scheduled
 *   from a refusal that came back from a request — Spotify's, or the server's
 *   cached 404, which is why it waits past `RECHECK_MIN_AGE_MS` — and from the
 *   page's memo only to restore one that was dropped unsent. A recheck's own
 *   refusal does not schedule another unless it was answered without asking
 *   Spotify (`notAsked`). The link keeps its key (`scheduledFor`) once a
 *   check went out or a request of the host's own cancelled it; only a check
 *   dropped unsent, or a button press our cache answered, gives it back.
 *   The key holds one link, so a host alternating between two refused links
 *   can earn each a check per switch — every one of them behind a request the
 *   host made.
 * - **The delay is past `RECHECK_MIN_AGE_MS`** in `lib/playlist-cache.ts`, or
 *   the server would replay the 404 it is meant to go past.
 * - **It yields.** The server replays the cached 404 instead of asking while
 *   Spotify is under pressure (`LoadOptions.automatic`), and the page holds it
 *   while the tab is hidden — a host who went to the Spotify app to change the
 *   setting is checked for when they come back, not while they are away.
 * - **Anything the host does first wins.** A press of the button or a Start that
 *   sends a request cancels it; a Start the memo answers does not — that host
 *   pressed the wrong button and is exactly who this is for. A new link in the
 *   field or a switch away from the single-playlist form hides the note at once
 *   and drops the check when it comes due; so does a check that could not go
 *   out within `AUTO_RECHECK_MAX_WAIT_MS` of being scheduled (the tab stayed
 *   hidden). An answer that lands after any of those, or while the host's own
 *   request is in flight, is dropped (`autoRecheckAnswerStillWanted`).
 * - **It only asks; it never starts the game.** A found playlist clears the
 *   refusal and tells the host to press Start — the playlist is in the cache
 *   by then, so that Start costs no Spotify call. Running the Start path
 *   instead navigated to `/game` half a minute after the refusal, under a host
 *   who was typing names, and swapped the refusal for a roster error when a
 *   name field was empty.
 * - **"Still private" only when Spotify said so.** The route marks a 404 it
 *   replayed from the cache without asking (`replayed: true`) — a recheck
 *   seconds after the last one, or an automatic one under pressure — and the
 *   page says nothing about the playlist then.
 *
 * Pure, and in `lib/`, for the reason `lib/start-status.ts` gives: the suite
 * cannot import the page.
 */

/** How long after a refusal the page checks again by itself. */
export const AUTO_RECHECK_DELAY_MS = 30_000;

/** How long the page's own check may take before it gives up and says to press the button. */
export const AUTO_RECHECK_TIMEOUT_MS = 10_000;

/**
 * The longest a check held for a hidden tab may still go out. Past it the host
 * has been away long enough that the refusal on screen is not the thing they
 * came back to.
 */
export const AUTO_RECHECK_MAX_WAIT_MS = 10 * 60 * 1000;

/**
 * The key a single-playlist submission is remembered under. One function so
 * the refusal memo and the timer cannot come to spell it differently — if
 * they did, the timer would never find its refusal and the check would
 * silently stop.
 */
export function ownSubmissionKey(playlistUrl: string): string {
  return `own:${playlistUrl}`;
}

/** The only code it is for: the help topic `private`. */
export const AUTO_RECHECK_CODE = "playlist_not_found";

/**
 * Should a refusal just shown schedule the automatic recheck?
 *
 * `scheduledFor` is the submission key (`own:<link>`) the page last scheduled
 * one for, or null.
 */
export function shouldScheduleAutoRecheck(args: {
  code: unknown;
  /** The refusal came back from a recheck — the button's or our own. */
  fromRecheck: boolean;
  /** That recheck was answered from our cache without asking Spotify. */
  notAsked: boolean;
  key: string;
  scheduledFor: string | null;
}): boolean {
  return (
    args.code === AUTO_RECHECK_CODE &&
    (!args.fromRecheck || args.notAsked) &&
    args.scheduledFor !== args.key
  );
}

/**
 * When the answer comes back: same as `autoRecheckStillWanted`, minus the
 * clock — the host may have changed the link, switched forms or sent their
 * own request while it was in flight, and then the answer is not theirs.
 */
export function autoRecheckAnswerStillWanted(args: {
  key: string;
  currentKey: string;
  rejectedKey: string | null;
  loading: boolean;
  singleMode: boolean;
  /** The private refusal is what the box shows now, not a later roster error. */
  refusalShown: boolean;
}): boolean {
  return (
    !args.loading &&
    args.singleMode &&
    args.refusalShown &&
    args.currentKey === args.key &&
    args.rejectedKey === args.key
  );
}

/**
 * When the timer fires: is the page still where it was when it scheduled it?
 * The same link in the field, the same refusal on screen, nothing in flight,
 * and not too long after.
 */
export function autoRecheckStillWanted(args: {
  key: string;
  currentKey: string;
  rejectedKey: string | null;
  loading: boolean;
  /** The single-playlist form is the one on screen. */
  singleMode: boolean;
  /** The private refusal is what the box shows now, not a later roster error. */
  refusalShown: boolean;
  /** Epoch ms the check was scheduled, and now. */
  scheduledAt: number;
  now: number;
}): boolean {
  return (
    autoRecheckAnswerStillWanted(args) && args.now - args.scheduledAt <= AUTO_RECHECK_MAX_WAIT_MS
  );
}

/**
 * What a recheck's answer says about the playlist.
 *
 *   found          it loaded — it is public now
 *   still_refused  Spotify was asked and said 404
 *   not_asked      our cached 404, handed back without asking Spotify
 *   other          anything that says nothing about the playlist
 */
export type RecheckAnswer = "found" | "still_refused" | "not_asked" | "other";

export function readRecheckAnswer(ok: boolean, body: unknown): RecheckAnswer {
  const value = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (ok) {
    return Array.isArray(value.tracks) && value.tracks.length > 0 ? "found" : "other";
  }
  if (value.code !== AUTO_RECHECK_CODE) return "other";
  return value.replayed === true ? "not_asked" : "still_refused";
}
