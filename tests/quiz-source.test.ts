// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { LOOP_SURFACES } from "@/lib/loop-links";
import {
  QUIZ_ARRIVALS,
  QUIZ_SOURCES,
  currentQuizSource,
  isQuizSource,
  quizSourceOf,
} from "@/lib/quiz-source";

/**
 * Where a quiz's maker came from, as `quiz_from:<source>` keys it.
 *
 * Two things here fail silently. The closed set is the tail of a KV key and
 * arrives in a request body, so a value outside it must be refused rather
 * than counted. And the referrer it is worked out from is somebody else's
 * URL — query string and all — which must never be what comes back.
 */

const HOST = "www.guessong.app";

describe("the closed set", () => {
  it("is every loop surface, derived, plus the three arrivals", () => {
    // Derived rather than retyped: a surface added to LOOP_SURFACES and not
    // here would be refused by the create route's guard, the quiz would still
    // be made, and that arm would read as "nobody came from it".
    expect(QUIZ_SOURCES).toEqual([...LOOP_SURFACES, "internal", "external", "none"]);
    for (const surface of LOOP_SURFACES) expect(isQuizSource(surface), surface).toBe(true);
    for (const arrival of QUIZ_ARRIVALS) expect(isQuizSource(arrival), arrival).toBe(true);
    const source = readFileSync(join(process.cwd(), "lib/quiz-source.ts"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      ""
    );
    for (const surface of LOOP_SURFACES) {
      expect(source, `lib/quiz-source.ts retypes "${surface}"`).not.toContain(`"${surface}"`);
    }
  });

  it("has no arrival that is also a surface's name", () => {
    // One key, two meanings: a surface called `internal` would be added to
    // every footer click.
    expect(new Set(QUIZ_SOURCES).size).toBe(QUIZ_SOURCES.length);
  });

  it("refuses anything else — it is the tail of a key, from a request body", () => {
    for (const bad of [
      "",
      "organic",
      "Internal",
      "EXTERNAL",
      "none ",
      "https://www.google.com/search?q=spotify+quiz",
      "__proto__",
      "constructor",
      "a".repeat(500),
      7,
      null,
      undefined,
      true,
      {},
      ["none"],
    ]) {
      expect(isQuizSource(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("quizSourceOf", () => {
  it("credits a remembered loop surface before it looks at the referrer", () => {
    // Last touch, like a game's `arrived_from`: a friend who finished a quiz
    // on Monday and comes back through a search on Thursday is still someone
    // the loop reached.
    for (const surface of LOOP_SURFACES) {
      expect(quizSourceOf({ ref: surface, referrer: "https://www.google.com/", host: HOST })).toBe(surface);
      expect(quizSourceOf({ ref: surface, referrer: "", host: HOST })).toBe(surface);
    }
  });

  it("does not take a ref that is not one of ours — `?ref=` is a public URL", () => {
    for (const ref of ["nonsense", "QUIZ_RESULT", "", "<script>", "none", "internal"]) {
      expect(quizSourceOf({ ref, referrer: "", host: HOST }), ref).toBe("none");
      expect(quizSourceOf({ ref, referrer: "https://t.co/abc", host: HOST }), ref).toBe("external");
    }
  });

  it("reads no referrer as none", () => {
    for (const referrer of ["", "   ", null, undefined]) {
      expect(quizSourceOf({ ref: null, referrer, host: HOST })).toBe("none");
    }
  });

  it("reads this site as internal, whichever spelling of it", () => {
    for (const referrer of [
      "https://www.guessong.app/",
      "https://www.guessong.app/guides/spotify-party-games?utm=x",
      "https://guessong.app/",
      "https://WWW.GUESSONG.APP/zh",
    ]) {
      expect(quizSourceOf({ ref: null, referrer, host: HOST }), referrer).toBe("internal");
    }
    // A preview deploy and localhost are this site to themselves, port included.
    expect(quizSourceOf({ ref: null, referrer: "http://127.0.0.1:8000/", host: "127.0.0.1:8000" })).toBe("internal");
    expect(quizSourceOf({ ref: null, referrer: "http://127.0.0.1:3000/", host: "127.0.0.1:8000" })).toBe("external");
  });

  it("reads anyone else's host as external, a lookalike included", () => {
    for (const referrer of [
      "https://www.google.com/",
      "https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.guessong.app%2Fquiz",
      "android-app://com.google.android.googlequicksearchbox/",
      "https://guessong.app.evil.example/",
      "https://notguessong.app/",
      "https://www.guessong.app.example.com/quiz",
    ]) {
      expect(quizSourceOf({ ref: null, referrer, host: HOST }), referrer).toBe("external");
    }
  });

  it("reads a referrer it cannot place as none, not as somebody sending them", () => {
    for (const referrer of ["not a url", "//", "about:blank", "javascript:void(0)", "data:text/html,x"]) {
      expect(quizSourceOf({ ref: null, referrer, host: HOST }), referrer).toBe("none");
    }
  });

  it("only ever answers with a member of the set, whatever the referrer holds", () => {
    // The referrer is a URL somebody else wrote. A pasted playlist address, a
    // search query, a token in a query string: none of it may come back.
    const secrets = [
      "https://www.google.com/search?q=my+secret+playlist",
      "https://example.com/?token=abc123&playlist=https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
      "https://www.guessong.app/?playlist=https://open.spotify.com/playlist/secret",
    ];
    for (const referrer of secrets) {
      const source = quizSourceOf({ ref: null, referrer, host: HOST });
      expect(QUIZ_SOURCES, referrer).toContain(source);
      expect(QUIZ_ARRIVALS as readonly string[], referrer).toContain(source);
    }
  });
});

describe("currentQuizSource", () => {
  it("answers without a document — the quiz page is prerendered", () => {
    // This file runs under node: no `window`, no `document`.
    expect(typeof window).toBe("undefined");
    expect(currentQuizSource(null)).toBe("none");
    expect(currentQuizSource("quiz_result")).toBe("quiz_result");
    expect(currentQuizSource("nonsense")).toBe("none");
  });
});

describe("the form and the route, as far as the suite can see them", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

  it("has the form send the source it worked out, and the same loop credit to both copies", () => {
    const form = code(read("app/quiz/quiz-create.tsx"));
    expect(form).toMatch(/const loopRef = recallLoopRef\(\);\s*const from = currentQuizSource\(loopRef\);/);
    expect(form).toMatch(/const body: CreateQuizRequest = \{[\s\S]*?\bfrom,\s*\};/);
    expect(form).toMatch(/arrived_from: arrivedFrom\(loopRef\),\s*quiz_from: from,/);
    // The referrer is read in lib/quiz-source.ts and nowhere on the page.
    expect(form).not.toMatch(/document\.referrer/);
  });

  it("has the route accept any value for it and count only one it recognises", () => {
    // An enum in the schema would refuse the host their quiz over a counter.
    const route = code(read("app/api/quiz/route.ts"));
    expect(route).toMatch(/from: z\.unknown\(\)\.optional\(\)/);
    expect(route).not.toMatch(/from: z\.enum/);
    expect(route).toMatch(/from: isQuizSource\(body\.from\) \? body\.from : undefined/);
  });

  it("reads the referrer in exactly one file, and never sends or logs it", () => {
    const readers = ["app", "components", "lib"]
      .flatMap((dir) => walk(join(process.cwd(), dir)))
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => /document\.referrer/.test(code(readFileSync(f, "utf8"))))
      .map((f) => f.slice(process.cwd().length + 1));
    expect(readers).toEqual(["lib/quiz-source.ts"]);
    const source = code(read("lib/quiz-source.ts"));
    expect(source).not.toMatch(/console\.|fetch\(|sendBeacon|trackEvent/);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
