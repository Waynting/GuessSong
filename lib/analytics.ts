/**
 * GA4 event wrapper — typed funnel events for GuessSong.
 *
 * The gtag script is installed in app/layout.tsx (only when
 * NEXT_PUBLIC_GA_MEASUREMENT_ID is set). This module is safe to call from
 * anywhere: it no-ops outside production, and silently does nothing when
 * window.gtag is unavailable (GA not configured, ad blocker, etc.).
 */

import type { ShareOutcome } from "@/lib/result-image";

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
