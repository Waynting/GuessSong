import { describe, it, expect, vi, beforeEach } from "vitest";
import { LOOP_SURFACES, arrivedFrom } from "@/lib/loop-links";
import { QUIZ_SETUP_HREF, isQuizSurface } from "@/lib/setup-arrival";

const recorded = vi.hoisted(() => ({
  clicks: [] as string[],
  throttled: 0,
}));

vi.mock("@/lib/loop-stats", () => ({
  recordLoopClick: async (surface: string) => {
    recorded.clicks.push(surface);
  },
  recordLoopThrottled: async () => {
    recorded.throttled += 1;
  },
}));

const { handleLoopHit, LOOP_FALLBACK_DESTINATION } = await import(
  "@/lib/loop-redirect"
);

beforeEach(() => {
  recorded.clicks = [];
  recorded.throttled = 0;
});

describe("handleLoopHit — the happy path", () => {
  it("counts the click and carries attribution to the setup page", async () => {
    const outcome = await handleLoopHit("buzz_cta", true);
    expect(outcome).toEqual({
      surface: "buzz_cta",
      destination: "/?ref=buzz_cta",
      counted: true,
      throttled: false,
    });
    expect(recorded.clicks).toEqual(["buzz_cta"]);
  });

  it("handles every declared surface, so no arm is silently unreachable", async () => {
    for (const surface of LOOP_SURFACES) {
      const outcome = await handleLoopHit(surface, true);
      expect(outcome.surface).toBe(surface);
      expect(outcome.counted).toBe(true);
      // A quiz surface lands on the quiz's own page; everything else on the
      // party form. Either way the ref rides along for attribution.
      const landing = isQuizSurface(surface) ? QUIZ_SETUP_HREF : "/";
      expect(outcome.destination).toBe(`${landing}?ref=${surface}`);
    }
    expect(recorded.clicks).toEqual([...LOOP_SURFACES]);
  });

  it("sends the quiz's warm arm to /quiz, not to the party form", async () => {
    const outcome = await handleLoopHit("quiz_result", true);
    expect(outcome.destination).toBe("/quiz?ref=quiz_result");
  });

  it("hands every landing page a ref it reads back as the surface that was clicked", async () => {
    // Both `/` and `/quiz` store the ref with `rememberLoopRef` and
    // `game_started` reads it through `arrivedFrom`. Parsed as a browser
    // would, so a landing that moved to a different path cannot pass on the
    // strength of a string prefix.
    for (const surface of LOOP_SURFACES) {
      const { destination } = await handleLoopHit(surface, true);
      const url = new URL(destination, "https://www.guessong.app");
      expect(["/", QUIZ_SETUP_HREF], surface).toContain(url.pathname);
      expect(arrivedFrom(url.searchParams.get("ref")), surface).toBe(surface);
    }
  });
});

describe("handleLoopHit — the visitor always lands somewhere useful", () => {
  it("redirects an unknown segment instead of 404ing the person", async () => {
    const outcome = await handleLoopHit("nonsense", true);
    expect(outcome.destination).toBe(LOOP_FALLBACK_DESTINATION);
    expect(outcome.surface).toBeNull();
  });

  it("spends no KV write on junk, which is what would fill the key space", async () => {
    for (const junk of [
      "",
      " ",
      "../../etc/passwd",
      "buzz_footer/../share",
      "__proto__",
      "BUZZ_CTA",
      "x".repeat(4096),
    ]) {
      const outcome = await handleLoopHit(junk, true);
      expect(outcome.counted).toBe(false);
      expect(outcome.destination).toBe(LOOP_FALLBACK_DESTINATION);
    }
    expect(recorded.clicks).toEqual([]);
    expect(recorded.throttled).toBe(0);
  });

  it("never reflects an unrecognised segment back into the URL", async () => {
    const outcome = await handleLoopHit("<script>alert(1)</script>", true);
    expect(outcome.destination).toBe("/");
    expect(outcome.destination).not.toContain("script");
  });

  it("still redirects when the window is spent — a party shares one IP", async () => {
    const outcome = await handleLoopHit("buzz_footer", false);
    expect(outcome.destination).toBe("/?ref=buzz_footer");
    expect(outcome.surface).toBe("buzz_footer");
  });

  it("keeps a throttled quiz click on the quiz page — the landing is decided before the limiter, not by it", async () => {
    // A class of thirty finishing one quiz behind one address is exactly
    // the case that spends the window. Losing the count is the deal; losing
    // the page they were promised is not.
    const outcome = await handleLoopHit("quiz_result", false);
    expect(outcome).toEqual({
      surface: "quiz_result",
      destination: "/quiz?ref=quiz_result",
      counted: false,
      throttled: true,
    });
  });
});

describe("handleLoopHit — the undercount is recorded, not hidden", () => {
  it("counts a throttled click as throttled rather than as nothing", async () => {
    const outcome = await handleLoopHit("share", false);
    expect(outcome).toEqual({
      surface: "share",
      destination: "/?ref=share",
      counted: false,
      throttled: true,
    });
    expect(recorded.throttled).toBe(1);
    expect(recorded.clicks).toEqual([]);
  });

  it("does not double-count a throttled click as both", async () => {
    await handleLoopHit("join_footer", false);
    expect(recorded.clicks).toEqual([]);
    expect(recorded.throttled).toBe(1);
  });

  it("does not record a throttle for a segment that was never ours", async () => {
    // Otherwise a crawler walking bad URLs would inflate the "we are
    // undercounting" signal and make a healthy week look throttled.
    await handleLoopHit("nonsense", false);
    expect(recorded.throttled).toBe(0);
    expect(recorded.clicks).toEqual([]);
  });
});
