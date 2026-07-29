import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { trackEvent } from "@/lib/analytics";

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
        playlist_source: "builtin",
      });
      trackEvent("round_completed", {
        round_index: 3,
        skipped: true,
        playlist_source: "builtin",
      });
      trackEvent("game_finished", {
        rounds_played: 12,
        total_tracks: 16,
        duration_seconds: 240,
        playlist_source: "builtin",
        correct_count: 7,
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
