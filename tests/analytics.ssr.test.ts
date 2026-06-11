// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { trackEvent } from "@/lib/analytics";

describe("trackEvent (SSR / no window)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not throw in production when window is undefined", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(typeof window).toBe("undefined");
    expect(() =>
      trackEvent("playlist_submitted", { playlist_source: "own" })
    ).not.toThrow();
  });
});
