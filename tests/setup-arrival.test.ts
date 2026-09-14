import { describe, it, expect } from "vitest";
import { LOOP_SURFACES } from "@/lib/loop-links";
import { QUIZ_SETUP_HREF, requestedSetupMode } from "@/lib/setup-arrival";

const query = (search: string) => new URLSearchParams(search);

describe("requestedSetupMode", () => {
  it("opens the quiz for a visitor who followed the quiz's own call to action", () => {
    // What /r/quiz_result redirects to. The person clicking has just finished
    // a friend's quiz and was promised they could make one; landing them on
    // Single Playlist is the bug this exists to fix.
    expect(requestedSetupMode(query("?ref=quiz_result"))).toBe("quiz");
  });

  it("opens the quiz for the explicit link the content pages use", () => {
    expect(requestedSetupMode(query("?mode=quiz"))).toBe("quiz");
    expect(requestedSetupMode(query(QUIZ_SETUP_HREF.slice(QUIZ_SETUP_HREF.indexOf("?"))))).toBe("quiz");
  });

  it("is a no-op for every other arrival", () => {
    for (const search of [
      "",
      "?",
      "?playlist=https://open.spotify.com/playlist/abc",
      "?ref=",
      "?ref=organic",
      "?ref=nonsense",
      "?mode=",
      "?mode=single",
      "?mode=mixed",
      "?mode=QUIZ",
      "?mode=quiz%20",
      "?modes=quiz",
      "?ref=quiz_result%20",
    ]) {
      expect(requestedSetupMode(query(search)), search).toBeNull();
    }
  });

  it("leaves the party surfaces alone — a buzzer footer click is a host, not a quiz maker", () => {
    for (const surface of LOOP_SURFACES) {
      if (surface === "quiz_result") continue;
      expect(requestedSetupMode(query(`?ref=${surface}`)), surface).toBeNull();
    }
  });

  it("does not let a stray ?mode override the loop's ref, or the other way round", () => {
    expect(requestedSetupMode(query("?ref=quiz_result&mode=single"))).toBe("quiz");
    expect(requestedSetupMode(query("?ref=share&mode=quiz"))).toBe("quiz");
  });

  it("keeps the content-page link relative and on the setup page", () => {
    // Same reason `loopHref` is relative: it has to work on a preview deploy.
    expect(QUIZ_SETUP_HREF.startsWith("/?")).toBe(true);
  });
});
