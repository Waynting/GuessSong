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
import { ERROR_LOCALES, type AppErrorCode, type ErrorLocale } from "@/lib/error-messages";
import type { LoopSurface } from "@/lib/loop-links";
import { QUIZ_VERDICTS, isQuizVerdict, type QuizVerdict } from "@/lib/quiz";
import type { ShareLinkOutcome } from "@/lib/quiz-share";
import { SOCIAL_PLATFORMS, isSocialPlatform, type SocialPlatform } from "@/lib/social-share";
import { QUIZ_SOURCES, isQuizSource, type QuizSource } from "@/lib/quiz-source";
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
 * How a game reached its Game Over screen, if it did.
 *
 *   played_out   the last track was played or skipped
 *   ended_early  the host pressed End Game with tracks left
 *
 * Neither is the number that matters on its own; the number is the gap. In
 * the week to 2026-09-22 `games` read 6,252 and `impression:game_over` — the
 * QR on that screen, once per tab — read 1,033, and nothing in KV could say
 * where the other five thousand went. The Game Over screen is where every
 * host-side loop surface lives (the QR, the result card, the install
 * banner), so a game that never reaches it is a game the loop never saw.
 * `games − (played_out + ended_early)` is the tab that closed mid-party, and
 * GA4's `game_finished.ended_early` — the only record before this — is on
 * the side nobody opens.
 *
 * Both are beacons from the page (`reportGameEnd` in `lib/loop-client.ts`),
 * fired once per game by the same guard as GA4's event, so they are floors:
 * a closed tab sends nothing, which is the point, and a beacon the browser
 * dropped reads as a closed tab. Read the gap as a direction.
 */
export type GameEnd = "played_out" | "ended_early";

export const GAME_ENDS: readonly GameEnd[] = ["played_out", "ended_early"];

/**
 * Above this, an early end's round stops getting its own key.
 *
 * Same shape and reason as `HOST_INDEX_CEILING`: the round comes from a
 * client counter. Twenty because that is the setup page's default song
 * count — an early end past it is a host who chose a long game and then
 * did not want one, and every such game answers the same way. Below it, the
 * exact round is the question: round one or two is a game that could not
 * play (no clip, wrong playlist, a phone that would not stay on); round
 * fifteen is a room that had enough.
 */
export const GAME_ROUND_CEILING = 20;

/**
 * Round zero: the game ended, or the page went away, before any clip had
 * started. Not a round — the bucket for a game that never played a note.
 *
 * `countRoundsPlayed` has always answered 0 for End Game pressed in the first
 * round's waiting phase, and until 2026-09-30 both `parsePulse` and
 * `recordGameEnd` clamped that up to 1. So "ended early at round 1" read 213
 * of 676 in the week to 2026-09-29 and could not say how many of those hosts
 * had heard a clip at all, which is the difference between "one song in, the
 * room was not interested" and "the game could not play". The floor is a
 * constant rather than a literal so the parser, the recorder and the key map
 * cannot disagree about where the histogram starts.
 */
export const GAME_ROUND_FLOOR = 0;

/**
 * Whether the host of a game that ended (or was left) had hosted before.
 *
 *   first    this device's first hosted game
 *   repeat   its second or later
 *   unknown  the page could not read the count — storage refused, or the
 *            start's write never landed
 *
 * The start counters (`host_index:<n>`) and the end counters were unjoined:
 * both were day totals, so "is the pile at rounds 0–2 people trying the site
 * once, or hosts who came back and whose game broke" had no answer, and the
 * two call for opposite work. The game page reads the stored count on mount —
 * the start on `/` has already bumped it, so the count *is* this game's index
 * — and sends the bucket with the end. Three values, not the index: the
 * question is binary, and an index here would multiply every key below by ten.
 *
 * Inherits the host count's floor (`lib/host-session.ts`): iOS evicts the
 * count after seven idle days, so `first` contains returning hosts the device
 * forgot. `repeat` is never wrong; `first` is a ceiling.
 */
export type GameHostKind = "first" | "repeat" | "unknown";

export const GAME_HOST_KINDS: readonly GameHostKind[] = ["first", "repeat", "unknown"];

/**
 * Where an unfinished game stopped, in the three bands that call for
 * different work: `r0` never played a clip, `r1_2` is the pile the reading
 * rule calls "a game that could not play", `r3_plus` is a room that played
 * and stopped. Banded only where it is crossed with the host kind — the
 * plain histograms keep the exact round — because kind × exact round is
 * sixty-three keys a day for a question three bands answer.
 */
export type EarlyEndBand = "r0" | "r1_2" | "r3_plus";

export const EARLY_END_BANDS: readonly EarlyEndBand[] = ["r0", "r1_2", "r3_plus"];

export function earlyEndBand(round: number): EarlyEndBand {
  if (round <= GAME_ROUND_FLOOR) return "r0";
  return round <= 2 ? "r1_2" : "r3_plus";
}

/**
 * Which layout the Game Over screen was drawn in. The phone layout is the
 * `max-width: 768px` one (`lib/game-over.ts`), and it is what decides
 * whether that screen shows the QR or the Mixed link — so it is also the
 * denominator `game_over_tap:mixed` needs, and the only record of how many
 * hosts reach the end on a phone at all.
 */
export type GameScreen = "phone" | "desktop";

export const GAME_SCREENS: readonly GameScreen[] = ["phone", "desktop"];

/**
 * How the first clip a host asked for came out, and whether its URL was
 * already in hand when they pressed Play.
 *
 *   prefetched  the batch prefetch had settled this track before the press
 *   lazy        it had not, so the press itself had to go and ask
 *
 *   played       the `<audio>` element reported sound
 *   rejected     `play()` was refused and the host was asked to tap again.
 *                The autoplay policy, all but always; an abort that nothing
 *                of ours caused lands here too, and is path-blind
 *   no_audio     nothing anywhere has a clip for the track (`absent`)
 *   unavailable  we could not answer: throttled, out of budget, offline
 *   error        the element failed to load the clip and the repair did too
 *   abandoned    the host skipped, revealed, ended or left before any of
 *                the above happened
 *
 * One per game page, for the first Play press only, because the hypothesis
 * it tests is about the first press: on the lazy path `play()` runs after an
 * `await`, outside the tap that asked for it, which is the classic way to be
 * refused on iOS — and round one is when the prefetch is least likely to
 * have landed. `lazy:rejected` well above `prefetched:rejected` confirms it;
 * the two level kills it. Later rounds are GA4's (`clip_blocked`).
 */
export type FirstClipPath = "prefetched" | "lazy";

export const FIRST_CLIP_PATHS: readonly FirstClipPath[] = ["prefetched", "lazy"];

export type FirstClipOutcome =
  | "played"
  | "rejected"
  | "no_audio"
  | "unavailable"
  | "error"
  | "abandoned";

export const FIRST_CLIP_OUTCOMES: readonly FirstClipOutcome[] = [
  "played",
  "rejected",
  "no_audio",
  "unavailable",
  "error",
  "abandoned",
];

/**
 * What a host tapped on the Game Over screen: `play_again` is the primary
 * button, `mixed` is the link to Mixed Playlist Mode that replaced the QR on
 * phones (994 shown, 3 followed — nobody scans a code off the phone in their
 * own hand). Both are client-side navigations, so unlike a loop link these
 * can be beacons: the document survives the tap.
 */
export type GameOverTap = "play_again" | "mixed";

export const GAME_OVER_TAPS: readonly GameOverTap[] = ["play_again", "mixed"];

/**
 * The setup page's nudge toward Mixed mode (`lib/mixed-nudge.ts`): `shown`
 * once per page load, `tapped`, and `started` for a Mixed game started after
 * a tap on this page. `started ÷ tapped` is whether it works.
 */
export type MixedNudgeStage = "shown" | "tapped" | "started";

export const MIXED_NUDGE_STAGES: readonly MixedNudgeStage[] = ["shown", "tapped", "started"];

/**
 * Who tapped a quiz's share button, and what came of it.
 *
 * `owner` is the panel on `/quiz` after a quiz is made — the step between
 * `quiz:created` and `quiz:opened`. `taker` is the result screen on
 * `/q/[code]`, a friend passing the link on. The outcome is `lib/quiz-share.ts`'s
 * verbatim: `shared` left the device through the share sheet, `copied` is the
 * clipboard fallback whose reach is unknowable, `dismissed` is the sheet
 * opened and backed out of, `failed` is neither path working.
 *
 * Exists because `opened ÷ created` read 0.6 in the week to 2026-09-22 —
 * 107 quizzes made, 59 opens, so most were never sent — and the only record
 * of *why* was GA4's `quiz_share_tapped`, on the side nobody opens. These
 * split "the owner never tapped share" from "the owner tapped it and the
 * sheet was dismissed" from "the sheet said shared and no friend opened it",
 * which are three different fixes. Every tap counts, so `owner` tallied
 * against `created` is a ceiling: one owner sending twice is two.
 *
 * `board` is the third place a share button lives: the owner's results page,
 * `/q/[code]/board`. Its two buttons reported to GA4 alone until 2026-09-30,
 * filed there as `owner`, so a second share arm was on the side nobody opens
 * and indistinguishable from the first on the side somebody might. It is the
 * same person as `owner` at a later moment — back for results, sending the
 * link on to whoever has not played — and is kept apart because that moment
 * is the one `docs/viral-loop.md` §7 calls "a second share arm going unused".
 *
 * **`quiz_share:<by>:copied` changed meaning on 2026-09-30, and a series that
 * straddles that date is two series.** Before it, the panel's explicit "Copy
 * link" button went through the same `settle()` as the share button, so
 * `owner:copied` was the desktop fallback *plus* every deliberate Copy tap —
 * 17 of the 19 owner taps in the week to 2026-09-29, with no way to say how
 * many of the 17 were which. From that date `copied` here means one thing:
 * the share button was tapped on a browser with no share sheet, and the
 * clipboard is what it fell back to. The Copy button has its own key,
 * `quiz_copy:<by>:<outcome>`, below. Expect `owner:copied` to step down on
 * the day this deployed; the taps did not stop, they moved.
 */
export type QuizShareBy = "owner" | "taker" | "board";

export const QUIZ_SHARE_BYS: readonly QuizShareBy[] = ["owner", "taker", "board"];

export type QuizShareOutcome = ShareLinkOutcome;

export const QUIZ_SHARE_OUTCOMES: readonly QuizShareOutcome[] = [
  "shared",
  "copied",
  "dismissed",
  "failed",
];

/**
 * What came of a tap on an explicit "Copy link" button — the panel's and the
 * board's. Keyed `quiz_copy:<by>:<outcome>`, by the same `QuizShareBy` the
 * share button uses, so the two read side by side.
 *
 * Two outcomes because a clipboard has two: it took the text, or it refused
 * (a locked-down webview, a page that lost focus). There is no `shared` and
 * no `dismissed` — no sheet is involved — which is the whole reason this is
 * not four more tails under `quiz_share:`: a `quiz_share:owner:copied` that
 * could mean either button is the reading this key exists to end.
 *
 * What a copy is evidence of: intent to send, by someone about to paste the
 * link somewhere this site cannot see. Whether they did is `opened`. Like a
 * share tap it is a count of taps and a ceiling on people.
 */
export type QuizCopyOutcome = Extract<ShareLinkOutcome, "copied" | "failed">;

export const QUIZ_COPY_OUTCOMES: readonly QuizCopyOutcome[] = ["copied", "failed"];

/**
 * A tap on one of the post-to-a-platform links (`lib/social-share.ts`),
 * keyed `quiz_social:<by>:<platform>`. They are drawn only on a browser with
 * no share sheet — the laptop, where 18 of 21 owner share taps fell back to
 * the clipboard — so read a row against the share row's `copied`, not its
 * total: that is the population that ever saw the links.
 *
 * A tap is the composer opening in a new tab, not a post. There is no
 * outcome, because nothing comes back from another site's tab; whether it
 * was posted is `opened`. A count of taps and a ceiling on people, like the
 * two keys above.
 */
export type QuizSocialPlatform = SocialPlatform;

export const QUIZ_SOCIAL_PLATFORMS: readonly QuizSocialPlatform[] = SOCIAL_PLATFORMS;

/**
 * Why a playlist link was refused, for the links that will never work.
 *
 * `lib/playlist-cache.ts` counts a replayed 404 as a hit and reports it
 * beside the rate — 952 of them in the week to 2026-09-22, one load in
 * eight against a link already known to be dead — but a 404 is a 404, and
 * an editorial playlist is refused before the cache is even read, so it was
 * in no count at all. This is the *reason*, from the closed set of codes
 * `isDeterministicPlaylistFailure` names, minus the two the route raises
 * for an empty field before `loadPlaylist` is called:
 *
 *   playlist_not_found     private, deleted, or never a playlist
 *   playlist_editorial     one of Spotify's own — refused, not broken
 *   playlist_empty         loaded, and had nothing playable
 *   invalid_playlist_url   parsed as nothing — an album or track link,
 *                          usually
 *
 * Which of these dominates is a product question the hit rate could not
 * ask: a wall of editorial refusals is a room that wants "Today's Top Hits"
 * and is told no, a wall of invalid URLs is a room pasting albums. Guarded
 * like every other key tail here, because `SpotifyApiError.code` is typed
 * but the rule does not care.
 */
export type PlaylistRefusalCode = Extract<
  AppErrorCode,
  "playlist_not_found" | "playlist_editorial" | "playlist_empty" | "invalid_playlist_url"
>;

export const PLAYLIST_REFUSAL_CODES: readonly PlaylistRefusalCode[] = [
  "playlist_not_found",
  "playlist_editorial",
  "playlist_empty",
  "invalid_playlist_url",
];

const PLAYLIST_REFUSAL_SET: ReadonlySet<string> = new Set(PLAYLIST_REFUSAL_CODES);

/** Narrows an error code to the ones `recordPlaylistRefused` will key. */
export function isPlaylistRefusalCode(value: unknown): value is PlaylistRefusalCode {
  return typeof value === "string" && PLAYLIST_REFUSAL_SET.has(value);
}

/**
 * What a "not a playlist URL" refusal actually was.
 *
 * `playlist_refused:invalid_playlist_url` read 748 in the week to 2026-09-29
 * — the second largest reason a link was turned away — and could not be read:
 * an album link, a track link, an artist page, a mobile short link and a
 * sentence typed into the field were one number. "Should the site play
 * albums" depends on how much of it is albums, so the split is measured
 * before anything is built.
 *
 *   album      a Spotify album link — the request the app cannot serve
 *   track      one song
 *   artist     an artist's page
 *   shortlink  a `spotify.link` that was followed and led nowhere usable: a
 *              dead slug, or a podcast, a profile, the home page
 *   other      no Spotify link in it at all, or one too mangled to read
 *
 * A short link that leads to an album is `album`, not `shortlink` — the
 * question is what people are trying to play, and how the link was spelled
 * is not part of it. A short link that could not be followed *this time* is
 * in neither: that is `playlist_shortlink:unavailable` below, it is
 * retryable, and it is not a refusal.
 *
 * **Written in the same call as `playlist_refused:invalid_playlist_url`, one
 * for one**, so the five sum to it exactly and that weekly series keeps its
 * meaning against the 748. `PLAYLIST_REFUSAL_CODES` stays the set of four:
 * this is a second reading of one of them, not a fifth.
 */
export type PlaylistInvalidKind = "album" | "track" | "artist" | "shortlink" | "other";

export const PLAYLIST_INVALID_KINDS: readonly PlaylistInvalidKind[] = [
  "album",
  "track",
  "artist",
  "shortlink",
  "other",
];

/**
 * How following a short link came out, for every one the server was handed —
 * through a form (`loadPlaylist`) or through Android's share sheet (`/share`).
 *
 *   resolved     it led to a playlist, an album, a track or an artist
 *   unusable     it answered, and led to none of those
 *   unavailable  it could not be followed: a timeout, a dropped connection,
 *                a reply that was not a redirect
 *
 * This is the only health check the resolver has. `spotify.link` is somebody
 * else's redirector answering a request from a shared datacentre address, and
 * how it treats one cannot be known from a laptop — the same reason a
 * throttled preview never reproduced locally. If `unavailable` is most of the
 * line, short links do not work from production and the feature is a slower
 * way of being refused.
 *
 * Counted on a cached answer too, so it is attempts, like the refusals.
 */
export type ShortlinkOutcome = "resolved" | "unusable" | "unavailable";

export const SHORTLINK_OUTCOMES: readonly ShortlinkOutcome[] = [
  "resolved",
  "unusable",
  "unavailable",
];

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

/**
 * The playlist quiz's funnel, one counter per stage.
 *
 *   created    a host turned a playlist into a link       POST /api/quiz
 *   opened     a friend's phone fetched the quiz          GET /api/quiz/[code]
 *   started    that phone answered its first question     POST /api/quiz/[code]/check, q=0
 *   completed  that phone sent answers                    POST /api/quiz/[code]/answer
 *   board      the owner came back for the results        GET /api/quiz/[code]/board
 *
 * Written by the five routes rather than beaconed from the page, because each
 * is a request that has already reached the server — there is nothing to lose
 * to a page tearing down. `opened` is counted by the API the page's own script
 * calls and *not* by `generateMetadata`, which every chat app's link unfurler
 * also fetches; counting there would invent opens nobody made.
 *
 * `started` is the check on question zero, which the page sends the moment
 * the first half is tapped and never again for that attempt (an answered
 * question is locked). It splits `opened → completed` in two: a friend who
 * read the intro and left, and one who played and stopped. Before it the
 * two were one number, and `of opens` could not say which page to fix. A
 * floor, like everything but `opened`: a check that never reached the
 * server — offline, or refused by the limiter — is a start nobody counted.
 *
 * `board` is the owner's half of the loop: a quiz whose board is never opened
 * is a link that was sent and forgotten, and `board ÷ created` is the only
 * number that says whether the results page — the one with the owner's share
 * button on it — is worth the token gate it sits behind. The route only counts
 * a successful, token-bearing read, so a friend who guesses the URL and lands
 * on `quiz_not_host` is not in it. Like `opened`, it is bumped per fetch and
 * the page fetches on every mount, so it is a ceiling.
 *
 * `opened` lost two things on 2026-09-30, and a series across that date steps
 * down without anything having changed on a phone. The result screen's
 * Refresh re-reads the view with `?refetch=1` (`QUIZ_REFETCH_PARAM` in
 * types/quiz.ts) and is no longer an open — it never was one. And a request
 * carrying the quiz's own host token is the owner, counted under
 * `QuizOwnerStage` below instead. What is left is one per page load by
 * someone who is not provably the owner: still a ceiling on friends, since a
 * reload is a second load, but no longer inflated by a button.
 *
 * `quiz_result`'s impression and click ride the ordinary surface counters, so
 * `completed` ≈ `impression:quiz_result` is a plumbing check: a gap means the
 * result screen stopped rendering the call to action.
 */
export type QuizStage = "created" | "opened" | "started" | "completed" | "board";

export const QUIZ_STAGES: readonly QuizStage[] = ["created", "opened", "started", "completed", "board"];

/**
 * The owner taking their own quiz, counted apart from the friends it was
 * made for.
 *
 *   owner_opened     the owner's device fetched the quiz   GET /api/quiz/[code]
 *   owner_completed  the owner's sheet was graded          POST /api/quiz/[code]/answer
 *
 * Keyed `quiz:owner_opened` and `quiz:owner_completed` — under the funnel's
 * prefix because they are the funnel's own stages seen from the other chair —
 * but declared as their own union rather than as two more `QuizStage`s, for
 * a reason that is about the numbers and not the types: each of these is
 * written *instead of* its namesake, never as well as. A verified owner's
 * open bumps `owner_opened` and not `opened`; their first check bumps nothing
 * where a friend's bumps `started`; their sheet bumps `owner_completed` and
 * not `completed`, not the verdict, not the length table — and writes no row.
 * So the friend-side funnel is friends, and nothing downstream of it has to
 * subtract.
 *
 * "Verified" is the host token, checked by the store the way the board's is
 * (`isQuizOwner` in lib/quiz-store.ts). A missing or wrong token is an
 * ordinary taker. That makes both of these **floors on owners, and `opened`
 * still a ceiling on friends**: the token lives in the creating browser's
 * localStorage, so an owner who opens their own link on another device, in a
 * chat app's in-app browser, or after iOS has evicted the storage is counted
 * as a friend, exactly as before.
 *
 * What each counts, exactly: `owner_opened` is page loads, like `opened` —
 * an owner who reloads is two, and the page's own re-reads are none.
 * `owner_completed` is sheets graded, and unlike `completed` it has no
 * replay to inflate it: the page keeps no finished row for a preview, so
 * there is no "see my result again" to re-POST. One owner who plays twice is
 * two, which is the thing being asked about.
 *
 * They exist to test one hypothesis — that owners want to play the quiz
 * themselves, which would make some of the quizzes "made and never sent" a
 * quiz made to be played — so the reading is `owner_opened ÷ created`, and
 * `owner_completed ÷ owner_opened` beside the friends' `completed ÷ opened`.
 * Before 2026-09-30 every one of these was inside `opened`, `started`,
 * `completed`, the verdicts and the length table, and on the public board.
 */
export type QuizOwnerStage = "owner_opened" | "owner_completed";

export const QUIZ_OWNER_STAGES: readonly QuizOwnerStage[] = ["owner_opened", "owner_completed"];

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
 * a clip the page reports as "no clip" for a reason that was ours, a 429 on
 * `check` is a question answered with no verdict shown — the page advances
 * without one, so nobody reports it — and a refusal on `card` is a chat
 * card drawn with the site's generic picture instead of the quiz's. The
 * answer limit was raised from 20 to 60 because the 21st finisher in an
 * office was being refused, and that was found from a report — nothing
 * counted it.
 *
 * A limiter refusal means KV is up (the `incr` that said no succeeded), so
 * unlike most of this file's counters this one is written in exactly the
 * situation it describes.
 */
export type QuizThrottledRoute = "create" | "read" | "check" | "answer" | "hint" | "board" | "card";

export const QUIZ_THROTTLED_ROUTES: readonly QuizThrottledRoute[] = [
  "create",
  "read",
  "check",
  "answer",
  "hint",
  "board",
  "card",
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
  hostSetup: Record<SetupSource, string>;
  quiz: Record<QuizStage, string>;
  quizOwner: Record<QuizOwnerStage, string>;
  quizVerdict: Record<QuizVerdict, string>;
  quizLength: Record<QuizLengthStage, Record<number, string>>;
  quizClamped: string;
  quizLocale: Record<ErrorLocale, string>;
  quizFrom: Record<QuizSource, string>;
  quizHint: Record<QuizHintOutcome, string>;
  quizThrottled: Record<QuizThrottledRoute, string>;
  quizShare: Record<QuizShareBy, Record<QuizShareOutcome, string>>;
  quizCopy: Record<QuizShareBy, Record<QuizCopyOutcome, string>>;
  quizSocial: Record<QuizShareBy, Record<QuizSocialPlatform, string>>;
  gameEnd: Record<GameEnd, string>;
  /** Indexed by round: `[0]` is round zero, `[GAME_ROUND_CEILING]` is "20+". */
  gameEndRound: string[];
  playlistInvalid: Record<PlaylistInvalidKind, string>;
  playlistShortlink: Record<ShortlinkOutcome, string>;
  gameEndHost: Record<GameHostKind, Record<GameEnd, string>>;
  gameEndEarly: Record<GameHostKind, Record<EarlyEndBand, string>>;
  gameEndScreen: Record<GameScreen, string>;
  /** Indexed by round, like `gameEndRound`. */
  gameLeftRound: string[];
  gameLeftHost: Record<GameHostKind, Record<EarlyEndBand, string>>;
  firstClip: Record<FirstClipPath, Record<FirstClipOutcome, string>>;
  gameOverTap: Record<GameOverTap, string>;
  mixedNudge: Record<MixedNudgeStage, string>;
  playlistRefused: Record<PlaylistRefusalCode, string>;
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
  const gameEndRound: string[] = [];
  const gameLeftRound: string[] = [];
  for (let n = GAME_ROUND_FLOOR; n <= GAME_ROUND_CEILING; n += 1) {
    gameEndRound.push(key(day, `game_end_round:${n}`));
    gameLeftRound.push(key(day, `game_left_round:${n}`));
  }
  /** `<prefix>:<host kind>:<tail>` for every kind, over one closed list of tails. */
  const byHost = <T extends string>(prefix: string, tails: readonly T[]) =>
    Object.fromEntries(
      GAME_HOST_KINDS.map((kind) => [
        kind,
        Object.fromEntries(tails.map((t) => [t, key(day, `${prefix}:${kind}:${t}`)])),
      ])
    ) as Record<GameHostKind, Record<T, string>>;
  return {
    live: key(day, "live"),
    throttled: key(day, "throttled"),
    games: key(day, "games"),
    repeatHost: key(day, "repeat_host"),
    impressions,
    clicks,
    hostIndex,
    gameEnd: {
      played_out: key(day, "game_end:played_out"),
      ended_early: key(day, "game_end:ended_early"),
    },
    gameEndRound,
    gameEndHost: byHost("game_end_host", GAME_ENDS),
    gameEndEarly: byHost("game_end_early", EARLY_END_BANDS),
    gameEndScreen: {
      phone: key(day, "game_end_screen:phone"),
      desktop: key(day, "game_end_screen:desktop"),
    },
    gameLeftRound,
    gameLeftHost: byHost("game_left_host", EARLY_END_BANDS),
    firstClip: Object.fromEntries(
      FIRST_CLIP_PATHS.map((path) => [
        path,
        Object.fromEntries(
          FIRST_CLIP_OUTCOMES.map((o) => [o, key(day, `first_clip:${path}:${o}`)])
        ),
      ])
    ) as Record<FirstClipPath, Record<FirstClipOutcome, string>>,
    gameOverTap: {
      play_again: key(day, "game_over_tap:play_again"),
      mixed: key(day, "game_over_tap:mixed"),
    },
    mixedNudge: Object.fromEntries(
      MIXED_NUDGE_STAGES.map((s) => [s, key(day, `mixed_nudge:${s}`)])
    ) as Record<MixedNudgeStage, string>,
    playlistRefused: Object.fromEntries(
      PLAYLIST_REFUSAL_CODES.map((c) => [c, key(day, `playlist_refused:${c}`)])
    ) as Record<PlaylistRefusalCode, string>,
    playlistInvalid: Object.fromEntries(
      PLAYLIST_INVALID_KINDS.map((k) => [k, key(day, `playlist_invalid:${k}`)])
    ) as Record<PlaylistInvalidKind, string>,
    playlistShortlink: Object.fromEntries(
      SHORTLINK_OUTCOMES.map((o) => [o, key(day, `playlist_shortlink:${o}`)])
    ) as Record<ShortlinkOutcome, string>,
    mixedPool: {
      room: key(day, "mixed_pool:room"),
      phone: key(day, "mixed_pool:phone"),
    },
    hostSetup: Object.fromEntries(
      SETUP_SOURCES.map((s) => [s, key(day, `host_setup:${s}`)])
    ) as Record<SetupSource, string>,
    quiz: {
      created: key(day, "quiz:created"),
      opened: key(day, "quiz:opened"),
      started: key(day, "quiz:started"),
      completed: key(day, "quiz:completed"),
      board: key(day, "quiz:board"),
    },
    quizOwner: Object.fromEntries(
      QUIZ_OWNER_STAGES.map((s) => [s, key(day, `quiz:${s}`)])
    ) as Record<QuizOwnerStage, string>,
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
    quizFrom: Object.fromEntries(
      QUIZ_SOURCES.map((s) => [s, key(day, `quiz_from:${s}`)])
    ) as Record<QuizSource, string>,
    quizHint: Object.fromEntries(
      QUIZ_HINT_OUTCOMES.map((o) => [o, key(day, `quiz_hint:${o}`)])
    ) as Record<QuizHintOutcome, string>,
    quizThrottled: Object.fromEntries(
      QUIZ_THROTTLED_ROUTES.map((r) => [r, key(day, `quiz_throttled:${r}`)])
    ) as Record<QuizThrottledRoute, string>,
    quizShare: Object.fromEntries(
      QUIZ_SHARE_BYS.map((by) => [
        by,
        Object.fromEntries(
          QUIZ_SHARE_OUTCOMES.map((o) => [o, key(day, `quiz_share:${by}:${o}`)])
        ),
      ])
    ) as Record<QuizShareBy, Record<QuizShareOutcome, string>>,
    quizCopy: Object.fromEntries(
      QUIZ_SHARE_BYS.map((by) => [
        by,
        Object.fromEntries(
          QUIZ_COPY_OUTCOMES.map((o) => [o, key(day, `quiz_copy:${by}:${o}`)])
        ),
      ])
    ) as Record<QuizShareBy, Record<QuizCopyOutcome, string>>,
    quizSocial: Object.fromEntries(
      QUIZ_SHARE_BYS.map((by) => [
        by,
        Object.fromEntries(
          QUIZ_SOCIAL_PLATFORMS.map((p) => [p, key(day, `quiz_social:${by}:${p}`)])
        ),
      ])
    ) as Record<QuizShareBy, Record<QuizSocialPlatform, string>>,
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
  mixed?: MixedSubMode,
  source?: SetupSource
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
  // One more, on every game from a page new enough to say. Guarded here as
  // well as in `parsePulse`, because this module owns the key space and the
  // rule for a key tail does not care what it was already checked against. A
  // game with no source — an older client, or a value outside the list — is
  // still a game: everything above has already counted it.
  if (source && SETUP_SOURCES.includes(source)) await bump(`host_setup:${source}`);
}

/**
 * A game reached its Game Over screen, and how.
 *
 * `roundsPlayed` is keyed only for an early end — for a game that played out
 * it is the song count the host chose, which is a different question and
 * already a GA4 param. Clamped to `GAME_ROUND_CEILING` for the reason the
 * host index is: it arrives from a page. The floor is `GAME_ROUND_FLOOR`,
 * zero, which is its own bucket and not a round.
 *
 * `details` is what a page from 2026-09-30 on adds, and both halves are
 * optional for the page that does not: a tab opened before that deploy sends
 * neither, and its end has to count exactly as it always did — the two
 * original keys, nothing else, and nothing filed under `unknown`, which
 * means "the page asked and storage would not say", not "the page was old".
 */
export async function recordGameEnd(
  end: GameEnd,
  roundsPlayed: number,
  details: { host?: GameHostKind; screen?: GameScreen } = {}
): Promise<void> {
  if (!GAME_ENDS.includes(end)) return;
  await bump(`game_end:${end}`);
  const host = isGameHostKind(details.host) ? details.host : null;
  const extras: Promise<void>[] = [];
  if (host) extras.push(bump(`game_end_host:${host}:${end}`));
  if (isGameScreen(details.screen)) extras.push(bump(`game_end_screen:${details.screen}`));
  if (end !== "ended_early") {
    await Promise.all(extras);
    return;
  }
  const round = clampRound(roundsPlayed);
  await bump(`game_end_round:${round}`);
  if (host) extras.push(bump(`game_end_early:${host}:${earlyEndBand(round)}`));
  await Promise.all(extras);
}

/** Guards for the key tails above. Each value reaches here from a request body. */
function isGameHostKind(value: unknown): value is GameHostKind {
  return typeof value === "string" && (GAME_HOST_KINDS as readonly string[]).includes(value);
}

function isGameScreen(value: unknown): value is GameScreen {
  return typeof value === "string" && (GAME_SCREENS as readonly string[]).includes(value);
}

/**
 * A round as a key tail: an integer from the floor to the ceiling. Clamped
 * rather than refused, like the host index beside it and for its reason — the
 * event is real whatever the counter says, and the key space is bounded
 * either way.
 */
function clampRound(round: number): number {
  return Number.isFinite(round)
    ? Math.max(GAME_ROUND_FLOOR, Math.min(Math.trunc(round), GAME_ROUND_CEILING))
    : GAME_ROUND_FLOOR;
}

/**
 * The first clip a host asked for, and how it came out. One per game page —
 * `createFirstClipTracker` in `lib/first-clip.ts` is what makes it one — so
 * the sum over every key is "games in which Play was pressed", and `games`
 * minus that sum is a game nobody ever pressed Play in (or a lost beacon).
 * Both halves are key tails and both are refused when unknown: a first clip
 * with half its description missing says nothing.
 */
export function recordFirstClip(path: FirstClipPath, outcome: FirstClipOutcome): Promise<void> {
  if (!FIRST_CLIP_PATHS.includes(path) || !FIRST_CLIP_OUTCOMES.includes(outcome)) {
    return Promise.resolve();
  }
  return bump(`first_clip:${path}:${outcome}`);
}

/**
 * The game page went away before the game reached Game Over: the tab was
 * closed, reloaded or navigated off. The other half of `recordGameEnd` —
 * between them they account for what `games` started, and what is left over
 * is a page that could send nothing at all.
 *
 * The round is `countRoundsPlayed`'s figure at the moment of leaving, the
 * same arithmetic as the end beacon, so the two histograms can be read
 * against each other row for row. The host band is written only when the
 * page sent a kind, for the reason `recordGameEnd` gives.
 */
export async function recordGameLeft(roundsPlayed: number, host?: GameHostKind): Promise<void> {
  const round = clampRound(roundsPlayed);
  await bump(`game_left_round:${round}`);
  if (isGameHostKind(host)) await bump(`game_left_host:${host}:${earlyEndBand(round)}`);
}

/** A tap on the Game Over screen. See `GameOverTap`. */
export function recordGameOverTap(target: GameOverTap): Promise<void> {
  if (!GAME_OVER_TAPS.includes(target)) return Promise.resolve();
  return bump(`game_over_tap:${target}`);
}

/** The setup page's Mixed nudge. See `MixedNudgeStage`. */
export function recordMixedNudge(stage: MixedNudgeStage): Promise<void> {
  if (!MIXED_NUDGE_STAGES.includes(stage)) return Promise.resolve();
  return bump(`mixed_nudge:${stage}`);
}

/**
 * A playlist link was refused for a reason that will not change. Written by
 * `loadPlaylist` in `lib/playlist-cache.ts` on the way out, for every caller
 * — the party form, a Mixed room's submit, the quiz — so a contributor's dead
 * link counts the same as a host's.
 */
export function recordPlaylistRefused(code: PlaylistRefusalCode): Promise<void> {
  if (!isPlaylistRefusalCode(code)) return Promise.resolve();
  return bump(`playlist_refused:${code}`);
}

/**
 * A link was refused as `invalid_playlist_url`, and this is what it was.
 *
 * One `Promise.all` with the refusal it splits, for the reason
 * `recordQuizCreated` gives: the marker memo is claimed before its write, so
 * the pair costs two commands and not three. Writing the two in one function
 * is also what keeps them one for one — a caller cannot bump the split and
 * forget the total, or the other way round.
 *
 * The kind is guarded before either write, so an undeclared one records
 * nothing at all rather than a total with no part.
 */
export async function recordPlaylistInvalid(kind: PlaylistInvalidKind): Promise<void> {
  if (!PLAYLIST_INVALID_KINDS.includes(kind)) return;
  await Promise.all([
    recordPlaylistRefused("invalid_playlist_url"),
    bump(`playlist_invalid:${kind}`),
  ]);
}

/**
 * A short link was followed, or could not be. Written by `resolveShortlink`
 * in `lib/spotify-shortlink.ts`, which is the one function both doors — the
 * forms and the share sheet — go through.
 */
export function recordShortlinkOutcome(outcome: ShortlinkOutcome): Promise<void> {
  if (!SHORTLINK_OUTCOMES.includes(outcome)) return Promise.resolve();
  return bump(`playlist_shortlink:${outcome}`);
}

/**
 * Someone tapped a quiz's share button. `reportQuizShare` in
 * `lib/loop-client.ts` sends it; both halves are key tails and both are
 * checked against their lists, because the body reached `/api/pulse` from
 * the open internet.
 */
export function recordQuizShare(by: QuizShareBy, outcome: QuizShareOutcome): Promise<void> {
  if (!QUIZ_SHARE_BYS.includes(by) || !QUIZ_SHARE_OUTCOMES.includes(outcome)) {
    return Promise.resolve();
  }
  return bump(`quiz_share:${by}:${outcome}`);
}

/**
 * Someone tapped an explicit "Copy link" button. `reportQuizCopy` in
 * `lib/loop-client.ts` sends it, through the same open endpoint a share
 * arrives by, so both halves are checked against their lists for the same
 * reason: each is the tail of a key.
 */
export function recordQuizCopy(by: QuizShareBy, outcome: QuizCopyOutcome): Promise<void> {
  if (!QUIZ_SHARE_BYS.includes(by) || !QUIZ_COPY_OUTCOMES.includes(outcome)) {
    return Promise.resolve();
  }
  return bump(`quiz_copy:${by}:${outcome}`);
}

/**
 * Someone tapped a post-to-a-platform link. `reportQuizSocial` in
 * `lib/loop-client.ts` sends it, through the same open endpoint as the two
 * above; both halves are key tails, so both are refused unless declared —
 * never clamped onto a neighbour, which would be a tap on a platform nobody
 * offered.
 */
export function recordQuizSocial(by: QuizShareBy, platform: QuizSocialPlatform): Promise<void> {
  if (!QUIZ_SHARE_BYS.includes(by) || !isSocialPlatform(platform)) {
    return Promise.resolve();
  }
  return bump(`quiz_social:${by}:${platform}`);
}

/** One quiz moved a stage down its funnel. */
export function recordQuizStage(stage: QuizStage): Promise<void> {
  return bump(`quiz:${stage}`);
}

/**
 * The owner's own open, or their own finished sheet — written by the route
 * *in place of* `recordQuizStage("opened")` and `recordQuizCompleted`, never
 * beside them. One command where a friend's completion is three: the verdict
 * and the length table describe how the quiz lands on the people it was made
 * for, and the person who picked the songs is not a reading of either.
 * Guarded like every key tail here, whatever the type says.
 */
export function recordQuizOwnerStage(stage: QuizOwnerStage): Promise<void> {
  if (!QUIZ_OWNER_STAGES.includes(stage)) return Promise.resolve();
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
 * And one about the person, since 2026-09-30:
 *
 *   quiz_from:<source>    where they came from — a loop surface, or one of
 *                         `internal` / `external` / `none` (lib/quiz-source.ts)
 *
 * Written only when the page sent a source this build recognises, so
 * `Σ quiz_from:* ≤ quiz:created` and the gap is quizzes made by a page from
 * before this shipped, or by something that is not the page. A floor on each
 * source and never a share of `created` without saying so.
 *
 * One `Promise.all` rather than four awaits in series: the host has already
 * waited on Spotify for this response, and the marker memo is claimed before
 * its write precisely so that concurrent bumps do not each pay for it.
 */
export async function recordQuizCreated(details: {
  questionCount: number;
  requestedCount: number;
  locale: ErrorLocale;
  from?: QuizSource;
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
  // The same guard, for the same reason, and it is the second one this value
  // meets: the route narrows it before calling, and this module owns the key
  // space whatever its callers did. Absent or unknown records nothing — not
  // `none`, which is a fact about a referrer and would be a lie here.
  if (isQuizSource(details.from)) {
    writes.push(bump(`quiz_from:${details.from}`));
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
