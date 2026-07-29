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

export type PlaylistSource = "own" | "builtin" | "mixed";
export type ShareType = "track" | "album" | "artist" | "unknown";
/** Which end-of-game image the player saved. */
export type ResultCardType = "scores" | "taste";

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
        correct_count?: number; // trial mode only
        game_mode?: GameMode;
        /** Buzzer mode only: most phones connected at once. The reach denominator. */
        peak_phone_count?: number;
      };
    }
  | {
      name: "preview_miss";
      params: {
        playlist_source: PlaylistSource;
        track_name?: string;
        artist?: string;
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
  | {
      name: "room_created";
      params: Record<string, never>;
    }
  | {
      name: "room_submission_received";
      params: { total: number };
    }
  | {
      name: "room_started";
      params: { contributor_count: number; unique_tracks: number };
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
      params: Record<string, never>;
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
