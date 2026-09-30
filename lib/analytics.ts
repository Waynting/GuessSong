/**
 * GA4 event wrapper — typed funnel events for GuessSong.
 *
 * The gtag script is installed in app/layout.tsx (only when
 * NEXT_PUBLIC_GA_MEASUREMENT_ID is set). This module is safe to call from
 * anywhere: it no-ops outside production, and silently does nothing when
 * window.gtag is unavailable (GA not configured, ad blocker, etc.).
 */

import type { ShareOutcome } from "@/lib/result-image";
// Type-only, so the analytics <-> game-session cycle is erased at compile time
// and never becomes a runtime import cycle.
import type { GameMode } from "@/lib/game-session";
import type { ArrivedFrom, LoopSurface } from "@/lib/loop-links";
// Type-only for the same reason: lib/loop-stats.ts imports lib/kv.ts, and a
// value import here would carry the Upstash client into the browser bundle.
import type { SetupSource } from "@/lib/loop-stats";
import type { QuizVerdict } from "@/lib/quiz";
import type { QuizSource } from "@/lib/quiz-source";

export type PlaylistSource = "own" | "mixed";
export type ShareType = "track" | "album" | "artist" | "unknown";
/**
 * Why a round had no audio. `absent` is a property of the recording, which is
 * ours to curate around; `unavailable` is a property of our own throttled
 * egress IP, which is ours to fix. See types/preview.ts.
 */
export type PreviewMissReason = "absent" | "unavailable";
/** Which end-of-game image the player saved. */
export type ResultCardType = "scores" | "taste";
/**
 * What the one room code is doing. Both room-created events carry it because a
 * combined room fires *both*, and without this param GA4 can only tell the two
 * apart by joining events within a session — which the standard reports can't do.
 */
export type RoomJobs = "playlists" | "buzzer" | "both";

/**
 * What a room is being asked to do, as the room-event params report it.
 *
 * Lives here rather than in the panel that calls it because it decides the
 * `room_jobs` param on every room-created and room-open-failed event: get it
 * wrong and the whole room funnel is mislabeled rather than merely missing. A
 * module-private helper inside a component is also unreachable from a test,
 * and this repo's suite covers `lib/` only.
 */
export function roomJobs(collectsPlaylists: boolean, buzzer: boolean): RoomJobs {
  if (collectsPlaylists && buzzer) return "both";
  return collectsPlaylists ? "playlists" : "buzzer";
}
/** Who fed the playlist mailbox. The host can't scan their own QR, so they have
 *  a separate path into it and a separate conversion rate. */
export type SubmittedBy = "player" | "host";
/** The join page a scanned phone actually landed on. See roomJoinUrl(). */
export type JoinPage = "buzz" | "j";
/**
 * Who is holding the phone on `/q/[code]`: the person who made the quiz, as
 * the server recognised them, or anyone else. `taker` is the word the rest of
 * the quiz code uses for a friend answering.
 */
export type QuizViewer = "owner" | "taker";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

/** The funnel + PWA events. Union type locks event names + param shapes. */
export type AnalyticsEvent =
  | {
      name: "playlist_submitted";
      params: { playlist_source: PlaylistSource };
    }
  | {
      name: "game_started";
      params: {
        player_count: number;
        clip_duration: number;
        song_count?: number;
        playlist_source: PlaylistSource;
        /**
         * Optional so every existing caller keeps compiling. Without it the
         * buzzer funnel can't be separated from the party funnel, and the
         * round-by-round drop-off curves of the two modes get averaged into
         * one meaningless line.
         */
        game_mode?: GameMode;
        /**
         * Which loop surface this host came in through, or `organic`.
         *
         * Last loop touch within `LOOP_REF_TTL_MS`, not same-pageview: the
         * conversion happens at a *later* party, so crediting only the visit
         * that carried the `?ref=` would record almost every real conversion
         * as organic and report a working loop as dead.
         *
         * Always produced by `arrivedFrom()`, never read straight off the URL
         * — `/?ref=` is public and this is a GA4 param.
         */
        arrived_from?: ArrivedFrom;
        /**
         * How the playlist got into the field: typed, restored from the last
         * game on this device, a recent or starter chip, the share target, or
         * `mixed` when there is no single link. The KV twin is
         * `host_setup:<source>`, and that is the one decisions are made from;
         * this copy is here to be cut by `host_game_index`, which KV cannot do
         * — "do returning hosts press Start on what was filled in" is a
         * question about two params on one event.
         *
         * A closed union, never the link itself: a pasted URL is user input.
         */
        setup_source?: SetupSource;
        /**
         * How many games this device has hosted, this one included. 1 for a
         * first-time host.
         *
         * A raw integer, not a bucket: CLAUDE.md's bucketing rule is about
         * *failure* params, where the value comes from an upstream string and
         * the hazard is cardinality and user input. Every count param already
         * here (`round_index`, `player_count`, `rounds_played`) is raw, and
         * bucketing at collection time would freeze the boundaries before the
         * distribution is known. The KV counter caps its own key space
         * separately, where the cardinality actually matters.
         */
        host_game_index?: number;
      };
    }
  | {
      name: "round_completed";
      params: {
        round_index: number; // 1-based
        skipped: boolean;
        playlist_source: PlaylistSource;
      };
    }
  | {
      name: "game_finished";
      params: {
        rounds_played: number;
        total_tracks: number;
        duration_seconds: number;
        playlist_source: PlaylistSource;
        game_mode?: GameMode;
        /** Buzzer mode only: most phones connected at once. The reach denominator. */
        peak_phone_count?: number;
        /**
         * The host pressed End Game before the last track was played out.
         * Quit used to leave without this event at all; now every exit is
         * one, so this is what keeps "finished" from meaning "abandoned".
         */
        ended_early: boolean;
        /**
         * Whether this device had hosted before, as the game page read it on
         * mount. The KV twin is `game_end_host:<kind>:<end>`; see
         * `GameHostKind` in lib/loop-stats.ts for why `first` is a ceiling.
         * Optional so a page that cannot say sends nothing rather than a guess.
         */
        host_kind?: "first" | "repeat" | "unknown";
        /**
         * Upcoming tracks taken out of the queue because nothing anywhere has
         * a clip for them (`dropSilentUpcoming`). `total_tracks` is the queue
         * as played, so `total_tracks + silent_skipped` is what the host
         * asked for. A count, like every other count here.
         */
        silent_skipped?: number;
      };
    }
  /*
   * Why a game did not go well, as the game page saw it. The KV copies are
   * `first_clip:*`, `game_left_round:*` and `game_over_tap:*` in
   * lib/loop-stats.ts, sent by the same functions in lib/loop-client.ts —
   * those are the ones decisions are made from. `clip_blocked` has no KV
   * twin: it is every refused `play()` in every round, which is cohorting,
   * where the first clip of the game is the instrument.
   */
  | {
      /**
       * How the first Play press of a game came out. Once per game page.
       * `path` is whether the clip's URL was in hand before the press; on
       * `lazy` the `play()` call runs after an await, outside the tap.
       */
      name: "first_clip";
      params: {
        path: "prefetched" | "lazy";
        outcome: "played" | "rejected" | "no_audio" | "unavailable" | "error" | "abandoned";
      };
    }
  | {
      /**
       * The browser refused a `play()` and the host was asked to tap again.
       * `site` is which of the page's four calls it was (`ClipSite` in
       * lib/clip-start.ts): `play` and `repair` can run outside the tap that
       * caused them, `resume` and `replay` cannot, so a count on either of
       * the second pair is a browser doing something this page does not
       * expect. `reason` is the rejection's kind, bucketed by
       * `classifyPlayRejection` — `refused` is the autoplay policy,
       * `interrupted` is an abort that nothing of ours caused — and never
       * its message.
       */
      name: "clip_blocked";
      params: {
        site: "play" | "resume" | "replay" | "repair";
        reason: "refused" | "interrupted";
        round_index: number; // 1-based, matches round_completed
      };
    }
  | {
      /**
       * The game page went away before Game Over. `via` separates the
       * document going (a closed tab, a reload) from the page being unmounted
       * under a live document (the back gesture); KV keeps only the round.
       */
      name: "game_left";
      params: {
        rounds_played: number;
        host_kind: "first" | "repeat" | "unknown";
        via: "unload" | "navigation";
      };
    }
  | {
      /**
       * A tap on the Game Over screen, and the layout it was drawn in.
       * `screen` is omitted, not guessed, when the page could not tell.
       */
      name: "game_over_tap";
      params: { target: "play_again" | "mixed"; screen?: "phone" | "desktop" };
    }
  | {
      name: "preview_miss";
      params: {
        playlist_source: PlaylistSource;
        track_name?: string;
        artist?: string;
        /**
         * Which kind of silence this was. Without it the two are one number,
         * and they call for opposite responses: `absent` is a catalogue gap and
         * the honest answer is to curate around it, while `unavailable` means
         * iTunes throttled our shared egress IP and the song is fine. Reading
         * the second as the first is what sent us hunting for missing songs
         * that were never missing.
         *
         * Optional so existing callers keep compiling; a bucketed enum, never a
         * raw upstream message, per this file's header.
         */
        reason?: PreviewMissReason;
      };
    }
  | {
      name: "mixed_pool_built";
      params: {
        contributor_count: number;
        unique_tracks: number;
        total_raw_tracks: number;
        overlap_count: number;
      };
    }
  /*
   * The room funnel. One code, two halves (mailbox + buzzer socket), and three
   * places a party can silently fall out of it:
   *
   *   room_created / buzz_room_created   host opened a room
   *   room_open_failed                   ...or couldn't. Worker down = the whole
   *                                      buzzer funnel vanishes, and without this
   *                                      event it looks like nobody tried.
   *   room_join_opened                   a phone landed on the join page. This is
   *                                      the DENOMINATOR: room_submission_received
   *                                      alone can't distinguish one scan that
   *                                      submitted from eight where seven bounced.
   *   room_submission_sent / _failed     the phone's own view of submitting, which
   *                                      the host's poll cannot see — a player who
   *                                      hit an error never reaches the mailbox, so
   *                                      host-side counting reads it as "no scan".
   *   room_submission_received           host's poll saw the mailbox grow
   *   room_started / room_start_failed   host consumed the pool and kicked off
   */
  | {
      name: "room_created";
      params: { room_jobs: RoomJobs };
    }
  | {
      name: "room_open_failed";
      params: {
        room_jobs: RoomJobs;
        /**
         * Bucketed, never the raw error message: messages come from upstream and
         * from user input, so sending them would blow up cardinality and could
         * carry a pasted URL into GA4.
         */
        reason: "buzzer_unavailable" | "other";
      };
    }
  | {
      name: "room_join_opened";
      params: { join_page: JoinPage; wants_playlist: boolean };
    }
  | {
      name: "room_submission_sent";
      params: { submitted_by: SubmittedBy; track_count: number };
    }
  | {
      name: "room_submission_failed";
      params: {
        submitted_by: SubmittedBy;
        /**
         * "too_late" is a 410 — the host already built the pool, so this phone
         * scanned after kickoff. Worth separating from a real error: it says the
         * mailbox closes before people finish arriving, which is a design
         * question, not a bug. "already_in" is a 409 on a name the mailbox
         * already holds: this phone submitted once, lost the flag that says so
         * (a browser that refuses storage, a reload) and asked again — no
         * playlist was lost, and the player goes on to the buzzer. Counted so
         * a rise in it reads as "phones are losing their flag", not as noise.
         */
        reason: "too_late" | "already_in" | "other";
      };
    }
  | {
      name: "room_submission_received";
      params: { total: number };
    }
  | {
      name: "room_started";
      params: { contributor_count: number; unique_tracks: number };
    }
  | {
      name: "room_start_failed";
      params: { contributor_count: number };
    }
  /*
   * Buzzer Mode events. These exist to answer five questions that no amount of
   * watching one's own parties can answer, because they need n=4000 rather than
   * n=1:
   *
   *   1. How many phones actually join a game?        buzz_player_joined
   *   2. Which round do people stop pressing?         buzz_received.round_index
   *   3. Is the clip the right length?                buzz_received.ms_since_round_open
   *      (first-buzz latency: if everyone buzzes at 2s, 15s clips are too long)
   *   4. Are the songs too hard?                      buzz_round_resolved.verdict
   *   5. How often does nobody know it?               buzz_round_resolved.buzz_count === 0
   *
   * Drop any of these and Buzzer Mode ships as a feature rather than as an
   * instrument, which was the whole reason for choosing this scope.
   */
  | {
      name: "buzz_room_created";
      params: { room_jobs: RoomJobs };
    }
  | {
      name: "buzz_player_joined";
      /** Running count of distinct phones in the room, not a per-join id. */
      params: { player_count: number };
    }
  | {
      name: "buzz_received";
      params: {
        round_index: number; // 1-based, matches round_completed
        /** 1 = won the round. Higher values are the queue behind the winner. */
        buzz_order: number;
        /** Reaction time as the room measured it, not as the phone claims. */
        ms_since_round_open: number;
      };
    }
  | {
      name: "buzz_round_resolved";
      params: {
        round_index: number;
        /** "revealed" means the host gave up on it — nobody got there. */
        verdict: "correct" | "wrong" | "revealed";
        /** 0 means the round opened and nobody pressed at all. */
        buzz_count: number;
      };
    }
  | {
      /**
       * End-of-game image save. The share buttons shipped long before this
       * event did, so until now the loop was unmeasurable — we knew the
       * feature existed but not whether anyone used it.
       *
       * `outcome` is the load-bearing param: only "shared" leaves the device
       * through the share sheet. Counting taps alone would overstate reach,
       * since a download or a dismissed sheet spreads nothing.
       */
      name: "result_shared";
      params: {
        card_type: ResultCardType;
        outcome: ShareOutcome;
        playlist_source: PlaylistSource;
      };
    }
  | {
      name: "pwa_install_prompt";
      params: { outcome: "accepted" | "dismissed" };
    }
  | {
      name: "share_unsupported";
      params: { share_type: ShareType };
    }
  | {
      /**
       * A form was shown a real Spotify link to the wrong thing — an album, a
       * track, an artist page — and said so under the field instead of
       * greying its button out in silence.
       *
       * This is the only record of those, and it is the weaker kind. The four
       * forms that block a submission never send the link, so
       * `playlist_invalid:<kind>` in lib/loop-stats.ts — the KV count, the
       * one decisions are made from — sees only the forms that do send:
       * the party form and the quiz. What is pasted into a room is here or
       * nowhere.
       *
       * Fired when the field's reading *becomes* one of the three, not per
       * keystroke. Bucketed by kind and by form; the link itself never
       * travels, for the reason every failure param in this file is an enum.
       */
      name: "playlist_link_named";
      params: {
        surface: "join" | "buzz" | "collector" | "room_panel";
        link_kind: "album" | "track" | "artist";
      };
    }
  | {
      /** Footer "What's new" overlay. `version` is the newest entry shown, so a
       *  release can be checked against how many people actually read it. */
      name: "changelog_opened";
      params: { version: string };
    }
  | {
      /**
       * A loop surface was rendered to someone. The denominator.
       *
       * Without it a click count cannot be read at all: twelve out of fifteen
       * is a working call to action and twelve out of nine thousand is a dead
       * one, and the two call for opposite responses. Deliberately not reusing
       * `room_join_opened`, which fires per page load rather than per person
       * (a phone that drops Wi-Fi and reloads counts twice) and so is a floor
       * rather than a denominator.
       */
      name: "loop_surface_shown";
      params: { surface: LoopSurface };
    }
  | {
      /**
       * Someone followed a loop link back to the setup page.
       *
       * The GA4 copy of a number the server also counts on `/r/[surface]`.
       * Both exist on purpose and they will disagree: an ad blocker kills this
       * one and not the redirect, a spent rate-limit window drops the redirect's
       * count and not this one. **KV is authoritative**; this
       * half is here for cohorting and for the questions nobody has thought of
       * yet — and the gap between the two is itself a reading of how much of
       * this audience blocks analytics.
       *
       * Fired with the navigation, so it must be sent in a way that survives
       * the page tearing down. See `lib/pulse-client.ts`.
       */
      name: "player_to_host_click";
      params: { surface: LoopSurface };
    }
  | {
      /**
       * A client-side exception reached an error boundary.
       *
       * Until `app/error.tsx` existed there was no boundary at all, so a throw
       * anywhere in the tree replaced the party with Next's default
       * "Application error" screen — and nothing anywhere recorded that it had
       * happened. The one crash we know about arrived as an email, weeks later,
       * from a host who had already given up.
       *
       * `boundary` is where it was caught, not what threw: `route` is the
       * segment boundary (a page or one of its effects), `root` is
       * `global-error.tsx`, which only fires when the root layout itself is the
       * thing that broke. Deliberately no message, stack or digest — the
       * convention this file keeps is bucketed enums, never upstream strings,
       * and a stack frame carries pasted playlist names and query params into
       * GA4. The digest goes to `console.error` on the device instead, which is
       * where the person reading it already is.
       */
      name: "client_error";
      params: { boundary: "route" | "root" };
    }
  /*
   * The playlist quiz. The KV copy of this funnel is in lib/loop-stats.ts
   * (`recordQuizStage`), and that is the copy decisions are made from; these
   * are here for cohorting — in particular `arrived_from = "quiz_result"`, the
   * 60-day conversion no server counter can see. The quiz link lands on
   * `/quiz`, so the natural conversion is a `quiz_created` with that ref; a
   * `game_started` with it is the same person weeks later.
   */
  | {
      name: "quiz_created";
      params: {
        question_count: number;
        arrived_from?: ArrivedFrom;
        /**
         * `arrived_from` with its `organic` split three ways — `internal`,
         * `external`, `none` — and the KV twin's exact value
         * (`quiz_from:<source>`, lib/quiz-source.ts). One of a closed set;
         * the referrer it was derived from never reaches a param.
         */
        quiz_from?: QuizSource;
      };
    }
  | {
      /** A friend's phone loaded a quiz. The denominator for `quiz_completed`. */
      name: "quiz_opened";
      params: {
        question_count: number;
        /**
         * `owner` when the server recognised this device's host token, and
         * the run is a preview that writes nothing. The KV twins are
         * `quiz:owner_opened` / `quiz:owner_completed`, which are counted
         * *instead of* the friend-side stages; here it is one event with a
         * param, so a report that does not filter on it is friends and
         * owners together. Absent on events from before 2026-09-30.
         */
        viewer?: QuizViewer;
      };
    }
  | {
      name: "quiz_completed";
      params: {
        question_count: number;
        correct: number;
        hints_used: number;
        /** Bucketed by lib/quiz.ts, never a raw score string. */
        verdict: QuizVerdict;
        /** See `quiz_opened`. */
        viewer?: QuizViewer;
      };
    }
  | {
      /**
       * The owner opened their results page, with the token. The KV twin is
       * `quiz:board` (`recordQuizStage("board")`), bumped by the route on the
       * same successful read. `takers` is how many rows were on it — bounded
       * by `QUIZ_MAX_ENTRIES`, so it is a number and not a cardinality risk —
       * and separates "came back to an empty board" from "came back to
       * results", which the count alone cannot.
       */
      name: "quiz_board_opened";
      params: { question_count: number; takers: number };
    }
  | {
      /**
       * A tap's verdict never reached the screen: the question advanced on
       * the plain fill and the sheet is still graded at the end, so nothing
       * on the page and nothing in KV says it happened — the server counts
       * only the limiter's refusals (`quiz_throttled:check`). `reason` is
       * bucketed: a 429 is `rate_limited`, any other coded refusal or a 5xx
       * is `server`, a 200 without an integer answer is `malformed`, an
       * abort past `CHECK_TIMEOUT_MS` is `timeout`, and a fetch that threw
       * with no response is `offline`. A quiz where this climbs is a quiz
       * being played through a slow KV, which no other counter can see.
       */
      name: "quiz_check_lost";
      params: { reason: "timeout" | "offline" | "rate_limited" | "server" | "malformed" };
    }
  | {
      /**
       * An explicit "Copy link" button — the panel's on `/quiz`, the board's
       * on `/q/[code]/board`. Split from `quiz_share_tapped` on 2026-09-30:
       * until then a Copy tap was filed there as `copied`, beside the share
       * button's clipboard fallback, and the two could not be told apart.
       * KV twin: `quiz_copy:<by>:<outcome>`.
       */
      name: "quiz_copy_tapped";
      params: {
        by: "owner" | "taker" | "board";
        outcome: "copied" | "failed";
      };
    }
  | {
      /**
       * The host's share button on the setup page, the taker's on the
       * result screen, or the owner's on their results page (`board`, which
       * was filed as `owner` until 2026-09-30). `outcome` follows
       * `result_shared`: only "shared" left the device through the share
       * sheet, and "copied" is the clipboard fallback whose reach is
       * unknowable — the fallback *only*, since the same date; a Copy button
       * is `quiz_copy_tapped`.
       */
      name: "quiz_share_tapped";
      params: {
        by: "owner" | "taker" | "board";
        outcome: "shared" | "copied" | "dismissed" | "failed";
      };
    };

export type AnalyticsEventName = AnalyticsEvent["name"];

type ParamsFor<N extends AnalyticsEventName> = Extract<
  AnalyticsEvent,
  { name: N }
>["params"];

export function trackEvent<N extends AnalyticsEventName>(
  name: N,
  params: ParamsFor<N>
): void {
  if (process.env.NODE_ENV !== "production") {
    // Dev / test: never send to GA4, log for local verification instead.
    console.debug("[analytics]", name, params);
    return;
  }
  if (typeof window === "undefined" || typeof window.gtag !== "function") {
    return;
  }
  window.gtag("event", name, params);
}
