/**
 * Server-side counters for the loop, in KV.
 *
 * ## Why these are not simply GA4 events
 *
 * They are also GA4 events. This is the second copy, and it exists because the
 * numbers have to arrive somewhere without anyone going to fetch them. Four
 * separate attempts to read the GA4 dashboard have not happened, so any plan
 * whose payoff is "and then open Analytics" has a measured completion rate of
 * zero and must be designed around rather than repeated. GA4 keeps the
 * cohorting and the exploration; this is the half that gets read.
 *
 * **The reader is `npm run stats` (`scripts/loop-stats.mjs`), not a pushed
 * digest.** An emailed weekly digest was designed and then dropped in favour of
 * a command, so anything here describing "the digest" was describing a file
 * that does not exist — `lib/digest.ts` was never written. The distinction
 * matters when adding a metric: the script discovers keys with `KEYS` rather
 * than being handed a list, so a new counter needs no registration to be
 * *counted*, only to be *named* well enough to read.
 *
 * The two will disagree, and that is expected: an ad blocker kills the GA4
 * event and not the redirect, while a spent rate-limit window drops the KV
 * increment and not the GA4 event. **KV is authoritative.**
 *
 * ## Every function here is fail-soft
 *
 * Same contract as `lib/playlist-cache.ts` and `lib/preview-cache.ts`: losing
 * the safety net has to mean "back to how it was", never "the feature broke".
 * A counter that can fail a redirect is a counter that costs you the user it
 * was trying to measure.
 */

import { dayBucket, getKvStore } from "@/lib/kv";
import { ERROR_LOCALES, type ErrorLocale } from "@/lib/error-messages";
import type { LoopSurface } from "@/lib/loop-links";
import { QUIZ_VERDICTS, isQuizVerdict, type QuizVerdict } from "@/lib/quiz";
import type { PreviewStatus } from "@/types/preview";
import { QUIZ_MAX_QUESTIONS, QUIZ_MIN_QUESTIONS } from "@/types/quiz";

/**
 * 30 days, not the 7 that `lib/playlist-cache.ts` uses for its own stats.
 *
 * A report reads a week at a time, so a 7-day TTL would expire the oldest day
 * or two of every single one right before it was read — and, worse, an expired
 * key is indistinguishable from one that was never written, so the loss would
 * render as "no data yet" rather than as a gap. 30 days also leaves room to go
 * a few weeks without looking and still be able to look back.
 */
export const LOOP_STATS_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Above this, `host_game_index` stops getting its own key.
 *
 * The index comes from a client counter, so without a ceiling the key space is
 * unbounded and one loop in a console fills KV with `host_index:99999` keys.
 * Ten is far past the point where the question ("does anyone host twice?") has
 * been answered.
 */
export const HOST_INDEX_CEILING = 10;

/**
 * Which of Mixed Playlist Mode's two collection routes built a game's pool.
 *
 * Lives here rather than in `lib/pulse.ts` for the same reason
 * `HOST_INDEX_CEILING` does: this module owns the `loop:stats:` key space, and
 * these two strings become the tail of a key. A guard over this list is what
 * stands between an unauthenticated request body and `mixed_pool:${anything}`.
 *
 * The sub-mode rides on `game_started` rather than arriving as an event of its
 * own, because it is a property of the game that started rather than a second
 * thing that happened. All three hosted-start paths already send that event
 * (`recordHostedStart` in `app/page.tsx`), so a separate event would have
 * described one occurrence twice and doubled a mixed game's KV cost for no
 * extra fact.
 *
 * Both values are needed because neither is visible anywhere else. The
 * `join_submitted` surface is rendered only by `/j/[code]`, and `roomJoinUrl`
 * sends players to `/buzz/[code]` whenever the buzzer is on — so a QR room with
 * a buzzer, which is the ordinary configuration, and the whole `"phone"` route
 * are both invisible to every counter that existed before this one.
 */
export type MixedSubMode = "room" | "phone";

export const MIXED_SUB_MODES: readonly MixedSubMode[] = ["room", "phone"];

/**
 * The playlist quiz's funnel, one counter per stage.
 *
 *   created    a host turned a playlist into a link       POST /api/quiz
 *   opened     a friend's phone fetched the quiz          GET /api/quiz/[code]
 *   completed  that phone sent answers                    POST /api/quiz/[code]/answer
 *   board      the owner came back for the results        GET /api/quiz/[code]/board
 *
 * Written by the four routes rather than beaconed from the page, because each
 * is a request that has already reached the server — there is nothing to lose
 * to a page tearing down. `opened` is counted by the API the page's own script
 * calls and *not* by `generateMetadata`, which every chat app's link unfurler
 * also fetches; counting there would invent opens nobody made.
 *
 * `board` is the owner's half of the loop: a quiz whose board is never opened
 * is a link that was sent and forgotten, and `board ÷ created` is the only
 * number that says whether the results page — the one with the owner's share
 * button on it — is worth the token gate it sits behind. The route only counts
 * a successful, token-bearing read, so a friend who guesses the URL and lands
 * on `quiz_not_host` is not in it. Like `opened`, it is bumped per fetch and
 * the page fetches on every mount, so it is a ceiling.
 *
 * `quiz_result`'s impression and click ride the ordinary surface counters, so
 * `completed` ≈ `impression:quiz_result` is a plumbing check: a gap means the
 * result screen stopped rendering the call to action.
 */
export type QuizStage = "created" | "opened" | "completed" | "board";

export const QUIZ_STAGES: readonly QuizStage[] = ["created", "opened", "completed", "board"];

/**
 * The two ends of a quiz's length: how many questions it was built with, and
 * how many it had when someone finished it. Both are keyed by the exact count
 * (`quiz_len:<stage>:<n>`), which is bounded because the count is — zod pins
 * `questionCount` to `QUIZ_MIN_QUESTIONS..QUIZ_MAX_QUESTIONS` at the route and
 * `buildQuiz` only ever shortens it — so the key space is 41 per stage per day
 * at the very most, and `recordQuizLength` refuses anything outside it.
 *
 * Exact rather than bucketed because the control the count comes from has
 * four one-tap presets and a typed field, and "does anyone use the typed
 * field" is a question about the values *between* the presets. Bucketing
 * would erase precisely the thing being asked.
 *
 * `completed` is keyed by length too so that finishers can be read *per quiz
 * made at that length*. `completed ÷ opened` cannot be split this way without
 * also splitting `opened`, and `opened` is a ceiling; `quiz_len:completed:n ÷
 * quiz_len:created:n` is two floors over each other, and is what says whether
 * a fifty-question quiz gets fewer friends through it than a ten.
 */
export type QuizLengthStage = "created" | "completed";

export const QUIZ_LENGTH_STAGES: readonly QuizLengthStage[] = ["created", "completed"];

/**
 * How a hint request came out. The first three are `PreviewStatus` verbatim
 * — the same fact `lib/preview-cache.ts` records for the game — and mean the
 * same things: `found` is a clip the taker heard, `absent` is a recording
 * nothing has a clip for, `unavailable` is us (throttled, out of budget) and
 * costs the taker nothing because the page refunds the hint.
 *
 * `refresh` is orthogonal to the other three and counted alongside them: a
 * `refresh=1` request is the page repairing a URL the CDN rotated, and it is
 * the one hint parameter that bypasses the cache. Its share of `found` is how
 * much of the year-long positive cache has rotted under the quiz.
 *
 * This is the only per-question upstream path the quiz has, and it exists in
 * a feature whose design rule is *no audio in a question* precisely so the
 * hottest path in the app is not multiplied by the number of friends. These
 * counters are how that rule is checked: `found ÷ completed` against the
 * allowance (`hintAllowance`, one per ten questions) says whether the ration
 * holds, and `unavailable` says whether the quiz is what is spending it.
 */
export type QuizHintOutcome = PreviewStatus | "refresh";

export const QUIZ_HINT_OUTCOMES: readonly QuizHintOutcome[] = [
  "found",
  "absent",
  "unavailable",
  "refresh",
];

const HINT_STATUS_SET: ReadonlySet<string> = new Set<PreviewStatus>([
  "found",
  "absent",
  "unavailable",
]);

/**
 * The quiz routes whose limiter can turn someone away, named for the counter.
 *
 * A refused request is a stage the funnel above cannot see: a 429 on `answer`
 * is a friend who finished every question and was bounced back to the name
 * card, a 429 on `read` is an open that never became one, a 429 on `hint` is
 * a clip the page reports as "no clip" for a reason that was ours. The answer
 * limit was raised from 20 to 60 because the 21st finisher in an office was
 * being refused, and that was found from a report — nothing counted it.
 *
 * A limiter refusal means KV is up (the `incr` that said no succeeded), so
 * unlike most of this file's counters this one is written in exactly the
 * situation it describes.
 */
export type QuizThrottledRoute = "create" | "read" | "answer" | "hint" | "board";

export const QUIZ_THROTTLED_ROUTES: readonly QuizThrottledRoute[] = [
  "create",
  "read",
  "answer",
  "hint",
  "board",
];

function key(day: string, metric: string): string {
  return `loop:stats:${day}:${metric}`;
}

/**
 * Every key one day of counters can hold.
 *
 * `scripts/loop-stats.mjs` discovers keys with `KEYS` rather than reading this,
 * so it is not the reader's contract; it is the writer's own description of
 * itself, and `tests/loop-stats.test.ts` is what holds the two together. That
 * makes it easy to forget when adding a metric, and forgetting is silent — the
 * test asserts with `toContain`, so a key missing from here fails nothing. Add
 * the field anyway: the value of this function is that one place answers "what
 * can exist under `loop:stats:`", and a description that is only mostly true is
 * the kind that gets trusted right up until it is wrong.
 */
export function loopStatsKeys(
  day: string,
  surfaces: readonly LoopSurface[]
): {
  live: string;
  throttled: string;
  games: string;
  repeatHost: string;
  impressions: Record<string, string>;
  clicks: Record<string, string>;
  hostIndex: string[];
  mixedPool: Record<MixedSubMode, string>;
  quiz: Record<QuizStage, string>;
  quizVerdict: Record<QuizVerdict, string>;
  quizLength: Record<QuizLengthStage, Record<number, string>>;
  quizClamped: string;
  quizLocale: Record<ErrorLocale, string>;
  quizHint: Record<QuizHintOutcome, string>;
  quizThrottled: Record<QuizThrottledRoute, string>;
} {
  const impressions: Record<string, string> = {};
  const clicks: Record<string, string> = {};
  for (const surface of surfaces) {
    impressions[surface] = key(day, `impression:${surface}`);
    clicks[surface] = key(day, `click:${surface}`);
  }
  const hostIndex: string[] = [];
  for (let n = 1; n <= HOST_INDEX_CEILING; n += 1) {
    hostIndex.push(key(day, `host_index:${n}`));
  }
  return {
    live: key(day, "live"),
    throttled: key(day, "throttled"),
    games: key(day, "games"),
    repeatHost: key(day, "repeat_host"),
    impressions,
    clicks,
    hostIndex,
    mixedPool: {
      room: key(day, "mixed_pool:room"),
      phone: key(day, "mixed_pool:phone"),
    },
    quiz: {
      created: key(day, "quiz:created"),
      opened: key(day, "quiz:opened"),
      completed: key(day, "quiz:completed"),
      board: key(day, "quiz:board"),
    },
    quizVerdict: Object.fromEntries(
      QUIZ_VERDICTS.map((v) => [v, key(day, `quiz_verdict:${v}`)])
    ) as Record<QuizVerdict, string>,
    quizLength: Object.fromEntries(
      QUIZ_LENGTH_STAGES.map((stage) => {
        const byCount: Record<number, string> = {};
        for (let n = QUIZ_MIN_QUESTIONS; n <= QUIZ_MAX_QUESTIONS; n += 1) {
          byCount[n] = key(day, `quiz_len:${stage}:${n}`);
        }
        return [stage, byCount];
      })
    ) as Record<QuizLengthStage, Record<number, string>>,
    quizClamped: key(day, "quiz_clamped"),
    quizLocale: Object.fromEntries(
      ERROR_LOCALES.map((l) => [l, key(day, `quiz_locale:${l}`)])
    ) as Record<ErrorLocale, string>,
    quizHint: Object.fromEntries(
      QUIZ_HINT_OUTCOMES.map((o) => [o, key(day, `quiz_hint:${o}`)])
    ) as Record<QuizHintOutcome, string>,
    quizThrottled: Object.fromEntries(
      QUIZ_THROTTLED_ROUTES.map((r) => [r, key(day, `quiz_throttled:${r}`)])
    ) as Record<QuizThrottledRoute, string>,
  };
}

/**
 * The day this instance has already written the liveness marker for.
 *
 * The marker answers one yes/no question — did the counters run at all today —
 * and its reader treats it that way: `scripts/loop-stats.mjs` only asks whether
 * the count is above zero, never what it is. Writing it alongside *every*
 * metric therefore bought nothing and doubled the cost of the whole loop
 * namespace; `recordGameStart` alone spent six commands where four would do,
 * and three of the six were the same key.
 *
 * Once per instance per UTC day is the cheapest thing that still cannot go
 * wrong. A lambda that serves one request writes it; a lambda that serves ten
 * thousand still writes it once; a fleet of instances writes it a handful of
 * times, which is a handful more than necessary and far fewer than before. The
 * only way to lose the marker is for every instance that ran that day to fail
 * its write, which is the KV outage the marker would be reporting anyway.
 *
 * Set only after a successful write, so an instance that fails once still tries
 * again on its next event rather than believing it has already reported.
 */
let livenessWrittenForDay: string | null = null;

/**
 * Bumps a counter, and the day's liveness marker if this instance has not yet.
 *
 * Without the marker a day with no clicks and a day the counters never ran look
 * identical: `mget` returns null for a key that was never created, which is
 * exactly what a genuine zero also looks like. Printing both as "no data yet"
 * would hide the single most important negative result this whole exercise can
 * produce — that the CTA does nothing. With a liveness marker, null-and-live is
 * a real zero and null-and-dead is a plumbing problem.
 */
async function bump(metric: string, by = 1): Promise<void> {
  try {
    const store = await getKvStore();
    const day = dayBucket();
    await store.incr(key(day, metric), LOOP_STATS_TTL_SECONDS, by);
    if (livenessWrittenForDay === day) return;
    // Claimed before the write, not after it: the quiz recorders below bump
    // several counters under one `Promise.all`, and with the memo set only on
    // return every one of them saw it empty at the same tick and wrote the
    // marker — the exact duplicate this memo exists to stop, on the first
    // event of the day. Released on failure so the next event tries again.
    livenessWrittenForDay = day;
    try {
      await store.incr(key(day, "live"), LOOP_STATS_TTL_SECONDS);
    } catch (err) {
      livenessWrittenForDay = null;
      throw err;
    }
  } catch {
    // Instrumentation must never be able to fail a request.
  }
}

/**
 * Test seam: the liveness memo is module state that outlives a single test, so
 * without this every case after the first would see the marker already written.
 */
export function __resetLivenessForTests(): void {
  livenessWrittenForDay = null;
}

/** A loop surface was rendered to someone. The denominator. */
export function recordLoopImpression(surface: LoopSurface): Promise<void> {
  return bump(`impression:${surface}`);
}

/** Someone followed a loop link. The numerator. */
export function recordLoopClick(surface: LoopSurface): Promise<void> {
  return bump(`click:${surface}`);
}

/**
 * A click that was not counted because the window was spent.
 *
 * Recorded so the undercount is visible in the digest instead of silently
 * depressing the click rate. A party is a dozen phones behind one NAT and the
 * limiter is keyed by IP, so this is a normal occurrence, not an attack.
 */
export function recordLoopThrottled(): Promise<void> {
  return bump("throttled");
}

/**
 * A hosted game started, and which number it was for this device.
 *
 * `hostGameIndex` is 1 for a first-time host. Anything at or above 2 is the
 * number the whole plan is waiting on: proof that someone came back. It is a
 * floor and not a measurement — iOS evicts localStorage after seven days
 * without interaction, which is exactly the gap between two parties, so a host
 * on a monthly rhythm reads as first-time forever.
 */
export async function recordGameStart(
  hostGameIndex: number,
  mixed?: MixedSubMode
): Promise<void> {
  const index = Number.isFinite(hostGameIndex)
    ? Math.max(1, Math.min(Math.trunc(hostGameIndex), HOST_INDEX_CEILING))
    : 1;
  await bump("games");
  await bump(`host_index:${index}`);
  if (index >= 2) await bump("repeat_host");
  // One extra command on a mixed game and none on any other. The alternative
  // considered was a second pulse event, which would have carried its own
  // liveness marker and cost a mixed game eight commands where this costs five.
  if (mixed) await bump(`mixed_pool:${mixed}`);
}

/** One quiz moved a stage down its funnel. */
export function recordQuizStage(stage: QuizStage): Promise<void> {
  return bump(`quiz:${stage}`);
}

/**
 * One quiz of `questionCount` questions was built, or finished.
 *
 * The count is the tail of the key, so it is checked against the same bounds
 * the route's schema enforces rather than trusted: this module owns the
 * `loop:stats:` key space, and the rule for anything that becomes part of a
 * key is a guard over a closed set, whatever it was already checked against
 * upstream. An out-of-range count records nothing rather than a clamped
 * value — a clamp would file it under a length nobody chose.
 */
export function recordQuizLength(stage: QuizLengthStage, questionCount: number): Promise<void> {
  if (
    !Number.isInteger(questionCount) ||
    questionCount < QUIZ_MIN_QUESTIONS ||
    questionCount > QUIZ_MAX_QUESTIONS
  ) {
    return Promise.resolve();
  }
  return bump(`quiz_len:${stage}:${questionCount}`);
}

/**
 * A host turned a playlist into a quiz. `POST /api/quiz`, on success.
 *
 * Three facts about the quiz that was made, plus one about the one that was
 * asked for:
 *
 *   quiz:created          the funnel's first stage
 *   quiz_len:created:<n>  how long it is — the built count, which is the quiz
 *   quiz_locale:<l>       the language the host made it in
 *   quiz_clamped          the playlist had fewer usable tracks than the host
 *                         asked for, so it was built shorter than requested
 *
 * `quiz_clamped` is the one the setup page cannot see. `buildQuiz` shortens
 * silently and the panel shows the count it got, so a host who typed 50 over
 * a 30-track playlist is handed a 30-question quiz with nothing on screen
 * saying why. This counter is how often that happens; if it is a large share
 * of `created`, the panel should say so before the host shares the link.
 *
 * One `Promise.all` rather than four awaits in series: the host has already
 * waited on Spotify for this response, and the marker memo is claimed before
 * its write precisely so that concurrent bumps do not each pay for it.
 */
export async function recordQuizCreated(details: {
  questionCount: number;
  requestedCount: number;
  locale: ErrorLocale;
}): Promise<void> {
  const writes = [
    recordQuizStage("created"),
    recordQuizLength("created", details.questionCount),
  ];
  // Guarded like the verdict: the value becomes the tail of a key, and the
  // locale reached the route from a request body.
  if ((ERROR_LOCALES as readonly string[]).includes(details.locale)) {
    writes.push(bump(`quiz_locale:${details.locale}`));
  }
  if (
    Number.isFinite(details.requestedCount) &&
    details.requestedCount > details.questionCount
  ) {
    writes.push(bump("quiz_clamped"));
  }
  await Promise.all(writes);
}

/**
 * A taker's answers were graded. `POST /api/quiz/[code]/answer`, on success.
 *
 *   quiz:completed            the funnel's last taker-side stage
 *   quiz_verdict:<bucket>     how it came out — the difficulty gauge
 *   quiz_len:completed:<n>    how long the quiz they finished was
 *
 * Counted on a replay too (a resend with the same `submissionId`), and when
 * the board was full and the row was not written: both are answer sheets that
 * were graded and shown, which is what "completed" means here. The board's
 * own row count is the number of *recorded* takers, and lives in the hash.
 */
export async function recordQuizCompleted(result: {
  questionCount: number;
  verdict: QuizVerdict;
}): Promise<void> {
  await Promise.all([
    recordQuizStage("completed"),
    recordQuizVerdict(result.verdict),
    recordQuizLength("completed", result.questionCount),
  ]);
}

/**
 * A hint was served, or could not be. `GET /api/quiz/[code]/hint`, on any
 * reply that was not a refusal — a refusal is `recordQuizThrottled("hint")`.
 *
 * Keyed by the preview's own status, guarded because it is a key tail; the
 * status came from `getPreview` and not from the request, but the rule does
 * not care where a string came from. `refresh` is counted *as well as* the
 * status when the request carried `refresh=1`, so a repaired clip is one
 * `found` and one `refresh`.
 */
export async function recordQuizHint(status: PreviewStatus, refresh: boolean): Promise<void> {
  const writes: Promise<void>[] = [];
  if (HINT_STATUS_SET.has(status)) writes.push(bump(`quiz_hint:${status}`));
  if (refresh) writes.push(bump("quiz_hint:refresh"));
  await Promise.all(writes);
}

/**
 * A quiz route turned a request away at the limiter.
 *
 * The funnel counts what got through; this is what did not, per route, so a
 * `completed ÷ opened` that reads low can be told apart from a limit set too
 * tight for a room full of phones behind one address. Written only where the
 * route's own `enforceRateLimit` returned a response, so the number is exact
 * for the routes that carry it — there is no client half to lose.
 */
export function recordQuizThrottled(route: QuizThrottledRoute): Promise<void> {
  if (!QUIZ_THROTTLED_ROUTES.includes(route)) return Promise.resolve();
  return bump(`quiz_throttled:${route}`);
}

/**
 * How a completed quiz came out, bucketed.
 *
 * The distribution is the difficulty gauge: a median at or above `soulmate`
 * means the decoys are too easy to spot, and that is the trigger for spending
 * an upstream call on better ones. Guarded by `isQuizVerdict` for the reason
 * `MIXED_SUB_MODES` is: the value becomes the tail of a key.
 */
export function recordQuizVerdict(verdict: QuizVerdict): Promise<void> {
  if (!isQuizVerdict(verdict)) return Promise.resolve();
  return bump(`quiz_verdict:${verdict}`);
}
