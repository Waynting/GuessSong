import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { roomJobs, trackEvent } from "@/lib/analytics";

describe("roomJobs", () => {
  // Decides room_jobs on every room-created and room-open-failed event. Wrong
  // here mislabels the whole room funnel rather than just losing an event.
  it("reports a room doing both jobs as \"both\"", () => {
    expect(roomJobs(true, true)).toBe("both");
  });

  it("reports a playlist-only room as \"playlists\"", () => {
    expect(roomJobs(true, false)).toBe("playlists");
  });

  it("reports a buzzer-only room as \"buzzer\"", () => {
    expect(roomJobs(false, true)).toBe("buzzer");
  });

  it("never returns \"playlists\" for a room that collects none", () => {
    // openRoom() rejects a room with no job at all, so (false, false) cannot
    // reach here — but if it ever did, claiming it collects playlists would be
    // the one wrong answer, because the pool would be attributed to a room
    // that never had a mailbox.
    expect(roomJobs(false, false)).not.toBe("playlists");
  });
});

describe("trackEvent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete window.gtag;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete window.gtag;
  });

  describe("non-production", () => {
    it("does not call window.gtag and logs via console.debug instead", () => {
      vi.stubEnv("NODE_ENV", "test");
      const gtag = vi.fn();
      window.gtag = gtag;
      const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

      trackEvent("playlist_submitted", { playlist_source: "own" });

      expect(gtag).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalledWith("[analytics]", "playlist_submitted", {
        playlist_source: "own",
      });
    });
  });

  describe("production", () => {
    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "production");
    });

    it("reports which card was saved and whether it actually left the device", () => {
      // outcome is the load-bearing param: a download or a dismissed share
      // sheet spreads nothing, so counting taps alone overstates reach.
      const gtag = vi.fn();
      window.gtag = gtag;

      trackEvent("result_shared", {
        card_type: "taste",
        outcome: "shared",
        playlist_source: "mixed",
      });

      expect(gtag).toHaveBeenCalledWith("event", "result_shared", {
        card_type: "taste",
        outcome: "shared",
        playlist_source: "mixed",
      });
    });

    it("distinguishes a dismissed share sheet from a completed one", () => {
      const gtag = vi.fn();
      window.gtag = gtag;

      trackEvent("result_shared", {
        card_type: "scores",
        outcome: "dismissed",
        playlist_source: "own",
      });

      expect(gtag).toHaveBeenCalledWith(
        "event",
        "result_shared",
        expect.objectContaining({ outcome: "dismissed" })
      );
    });

    it("passes event name and params to window.gtag", () => {
      const gtag = vi.fn();
      window.gtag = gtag;

      trackEvent("game_started", {
        player_count: 4,
        clip_duration: 15,
        playlist_source: "own",
      });

      expect(gtag).toHaveBeenCalledTimes(1);
      expect(gtag).toHaveBeenCalledWith("event", "game_started", {
        player_count: 4,
        clip_duration: 15,
        playlist_source: "own",
      });
    });

    it("sends each of the five funnel events with its params", () => {
      const gtag = vi.fn();
      window.gtag = gtag;

      trackEvent("playlist_submitted", { playlist_source: "own" });
      trackEvent("game_started", {
        player_count: 1,
        clip_duration: 10,
        playlist_source: "mixed",
      });
      trackEvent("round_completed", {
        round_index: 3,
        skipped: true,
        playlist_source: "mixed",
      });
      trackEvent("game_finished", {
        rounds_played: 12,
        total_tracks: 16,
        duration_seconds: 240,
        playlist_source: "mixed",
      });
      trackEvent("preview_miss", {
        playlist_source: "own",
        track_name: "Song",
        artist: "Artist",
      });

      expect(gtag).toHaveBeenCalledTimes(5);
      expect(gtag.mock.calls.map((c) => c[1])).toEqual([
        "playlist_submitted",
        "game_started",
        "round_completed",
        "game_finished",
        "preview_miss",
      ]);
      // every call goes through the gtag "event" command
      expect(gtag.mock.calls.every((c) => c[0] === "event")).toBe(true);
    });

    it("carries room_jobs on both room-created events, so a combined room is separable", () => {
      // A combined room fires room_created AND buzz_room_created. Without this
      // param GA4's standard reports can't tell that pair from two unrelated
      // rooms opened in one session.
      const gtag = vi.fn();
      window.gtag = gtag;

      trackEvent("room_created", { room_jobs: "both" });
      trackEvent("buzz_room_created", { room_jobs: "both" });

      expect(gtag.mock.calls).toEqual([
        ["event", "room_created", { room_jobs: "both" }],
        ["event", "buzz_room_created", { room_jobs: "both" }],
      ]);
    });

    it("sends the whole room funnel, landings and failures included", () => {
      const gtag = vi.fn();
      window.gtag = gtag;

      trackEvent("room_created", { room_jobs: "playlists" });
      trackEvent("room_open_failed", { room_jobs: "buzzer", reason: "buzzer_unavailable" });
      trackEvent("room_join_opened", { join_page: "buzz", wants_playlist: true });
      trackEvent("room_submission_sent", { submitted_by: "player", track_count: 42 });
      trackEvent("room_submission_failed", { submitted_by: "player", reason: "too_late" });
      trackEvent("room_submission_received", { total: 3 });
      trackEvent("room_started", { contributor_count: 3, unique_tracks: 24 });
      trackEvent("room_start_failed", { contributor_count: 3 });

      expect(gtag.mock.calls.map((c) => c[1])).toEqual([
        "room_created",
        "room_open_failed",
        "room_join_opened",
        "room_submission_sent",
        "room_submission_failed",
        "room_submission_received",
        "room_started",
        "room_start_failed",
      ]);
      expect(gtag.mock.calls.every((c) => c[0] === "event")).toBe(true);
    });

    it("keeps room_open_failed's reason bucketed rather than passing the raw message", () => {
      // Error messages come from upstream and from pasted user input; sending
      // them verbatim would blow up cardinality and could carry a playlist URL
      // into GA4.
      const gtag = vi.fn();
      window.gtag = gtag;

      trackEvent("room_open_failed", { room_jobs: "both", reason: "other" });

      const params = gtag.mock.calls[0][2] as Record<string, unknown>;
      expect(params.reason).toBe("other");
      expect(Object.keys(params).sort()).toEqual(["reason", "room_jobs"]);
    });

    it("does not throw and does not log when window.gtag is missing", () => {
      const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

      expect(() =>
        trackEvent("playlist_submitted", { playlist_source: "own" })
      ).not.toThrow();
      expect(debug).not.toHaveBeenCalled();
    });

    it("does not throw when window.gtag is not a function", () => {
      // ad blockers / partial loads can leave odd globals behind
      (window as unknown as Record<string, unknown>).gtag = "not-a-function";

      expect(() =>
        trackEvent("playlist_submitted", { playlist_source: "own" })
      ).not.toThrow();
    });
  });
});
