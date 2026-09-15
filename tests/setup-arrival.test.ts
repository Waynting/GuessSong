import { describe, it, expect } from "vitest";
import { LOOP_SURFACES, arrivedFrom } from "@/lib/loop-links";
import { QUIZ_SETUP_HREF, isQuizSurface, quizArrivalHref, requestedSetupMode } from "@/lib/setup-arrival";

const query = (search: string) => new URLSearchParams(search);

describe("requestedSetupMode", () => {
  it("opens the quiz for a visitor who followed the quiz's own call to action", () => {
    // What /r/quiz_result redirects to. The person clicking has just finished
    // a friend's quiz and was promised they could make one; landing them on
    // Single Playlist is the bug this exists to fix.
    expect(requestedSetupMode(query("?ref=quiz_result"))).toBe("quiz");
  });

  it("still recognises the old ?mode=quiz link, so a stale content page redirects", () => {
    expect(requestedSetupMode(query("?mode=quiz"))).toBe("quiz");
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

  it("keeps the content-page link relative and on the quiz's own page", () => {
    // Same reason `loopHref` is relative: it has to work on a preview deploy.
    expect(QUIZ_SETUP_HREF).toBe("/quiz");
  });
});

describe("isQuizSurface", () => {
  it("names the quiz's warm arm and nothing else", () => {
    // Two readers, one set: lib/loop-redirect.ts sends these clicks to /quiz
    // and `/` catches the ones that still arrive the old way. A surface here
    // that is not in `requestedSetupMode` — or the reverse — is a click that
    // lands on the quiz from one door and on the party form from the other.
    expect(isQuizSurface("quiz_result")).toBe(true);
    for (const surface of LOOP_SURFACES) {
      expect(isQuizSurface(surface), surface).toBe(requestedSetupMode(query(`?ref=${surface}`)) === "quiz");
    }
  });

  it("leaves the party surfaces alone", () => {
    for (const surface of LOOP_SURFACES) {
      if (surface === "quiz_result") continue;
      expect(isQuizSurface(surface), surface).toBe(false);
    }
  });
});

describe("quizArrivalHref", () => {
  it("sends an old-style arrival to /quiz, carrying a loop ref with it", () => {
    expect(quizArrivalHref(query("?ref=quiz_result"))).toBe("/quiz?ref=quiz_result");
    expect(quizArrivalHref(query("?mode=quiz&ref=quiz_result"))).toBe("/quiz?ref=quiz_result");
  });

  it("drops everything that is not one of our surfaces", () => {
    expect(quizArrivalHref(query("?mode=quiz"))).toBe("/quiz");
    expect(quizArrivalHref(query("?mode=quiz&ref=%3Cscript%3E"))).toBe("/quiz");
    expect(quizArrivalHref(query("?mode=quiz&playlist=x"))).toBe("/quiz");
  });

  it("keeps any of our surfaces on the hop, not only the quiz's — attribution is the loop's, not the page's", () => {
    // `?ref=share&mode=quiz` is a person who scanned a result card and then
    // followed a stale content-page link; the click they are credited with
    // is still the card's. Dropping it because it is not the quiz's own arm
    // would fold a real arrival into `organic`.
    for (const surface of LOOP_SURFACES) {
      expect(quizArrivalHref(query(`?mode=quiz&ref=${surface}`)), surface).toBe(`/quiz?ref=${surface}`);
    }
  });

  it("is exact about the ref, the way the redirect route is about its segment", () => {
    for (const search of [
      "?mode=quiz&ref=",
      "?mode=quiz&ref=QUIZ_RESULT",
      "?mode=quiz&ref=quiz_result%20",
      "?mode=quiz&ref=quiz_result/../share",
      "?mode=quiz&ref=organic",
      "?mode=quiz&ref=__proto__",
      `?mode=quiz&ref=${"x".repeat(4096)}`,
    ]) {
      expect(quizArrivalHref(query(search)), search).toBe(QUIZ_SETUP_HREF);
    }
  });

  it("never reflects anything into the URL that the redirect could not have put there", () => {
    // The href goes straight into `window.location.replace`. Whatever the
    // query held, the result is `/quiz` or `/quiz?ref=<declared surface>`.
    const allowed = new Set<string>([QUIZ_SETUP_HREF, ...LOOP_SURFACES.map((s) => `${QUIZ_SETUP_HREF}?ref=${s}`)]);
    for (const search of [
      "?mode=quiz&ref=%3Cscript%3Ealert(1)%3C/script%3E",
      "?mode=quiz&ref=javascript:alert(1)",
      "?mode=quiz&ref=//evil.example",
      "?ref=quiz_result&ref=%3Cscript%3E",
      "?ref=%3Cscript%3E&ref=quiz_result",
      "?mode=quiz&playlist=https://open.spotify.com/playlist/abc&ref=share",
    ]) {
      expect(allowed.has(quizArrivalHref(query(search))), search).toBe(true);
    }
  });

  it("produces a URL whose ref the quiz page reads back as the same surface", () => {
    // `/quiz` stores the ref with `rememberLoopRef` and `game_started` later
    // reads it through `arrivedFrom`; the hop must not lose the name in
    // between. Parsed the way the browser will, not by string comparison.
    for (const surface of LOOP_SURFACES) {
      const href = quizArrivalHref(query(`?ref=${surface}`));
      const url = new URL(href, "https://www.guessong.app");
      expect(url.pathname).toBe(QUIZ_SETUP_HREF);
      expect(arrivedFrom(url.searchParams.get("ref"))).toBe(surface);
    }
    const bare = new URL(quizArrivalHref(query("?mode=quiz")), "https://www.guessong.app");
    expect(bare.pathname).toBe(QUIZ_SETUP_HREF);
    expect(arrivedFrom(bare.searchParams.get("ref"))).toBe("organic");
  });
});
