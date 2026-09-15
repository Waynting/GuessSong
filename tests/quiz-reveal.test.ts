// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QUIZ_COPY } from "@/lib/quiz-copy";

/**
 * The per-question reveal on the taker page, as far as the suite can see it.
 *
 * `app/q/[code]/quiz-client.tsx` is a client component and vitest cannot
 * import a `.tsx` module here, so the flow itself — tap, verdict, advance —
 * is verified in a browser. What this file pins is the set of one-line
 * invariants the flow rests on, each of which fails silently if undone: the
 * page would still render, the quiz would still grade, and the key would
 * simply start leaving the server one question early, or a stale closure
 * would send a sheet with a `-1` in it. Read the source, the way
 * tests/quiz-unfurl.test.ts reads the page beside it.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const CLIENT = "app/q/[code]/quiz-client.tsx";

/** The source with its comments removed, so a rule named in prose does not pass for one in code. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("the reveal asks for one question's key against a pick for it", () => {
  const source = read(CLIENT);
  const body = code(source);

  it("sends the check to its own route, with the pick, and never names the answer to the preview route", () => {
    // The key is handed over per question and only in exchange for a pick;
    // `/api/preview?track=…` from the phone would put the answer in the
    // request, which is the rule the hint route exists to keep.
    expect(body).toMatch(/fetch\(`\/api\/quiz\/\$\{encodeURIComponent\(code\)\}\/check`/);
    expect(body).toMatch(/const body: CheckQuizRequest = \{ q, pick \}/);
    expect(body).not.toMatch(/fetch\(`?["'`]?\/api\/preview/);
    // Every fetch the page makes is to the quiz's own routes.
    for (const call of body.match(/fetch\(`[^`]*`/g) ?? []) {
      expect(call).toMatch(/^fetch\(`\/api\/quiz\//);
    }
  });

  it("locks a question on the first tap: a second finger, a revisit, and the disabled halves all refuse", () => {
    // Three guards on one rule, and each covers a case the others do not: the
    // ref is read synchronously so two taps in one frame see the lock before
    // the state has rendered; the answers check is what a revisited question
    // fails; `disabled` is what the browser enforces without a handler.
    expect(body).toMatch(/if \(!view \|\| phase === "submitting" \|\| answers\[index\] >= 0 \|\| locked\.current === index\) return;/);
    expect(body).toMatch(/locked\.current = index;/);
    expect(body).toMatch(/disabled=\{busy \|\| chosen >= 0\}/);
    // And once answered, the clip is not on offer: the verdict is on screen.
    expect(body).toMatch(/const canHear = chosen < 0 && \(/);
  });

  it("takes the round token before the await and advances through the ref, never the closure", () => {
    // `begin()` returns its own comparison (lib/round-token.ts), and it has
    // to be taken at the tap: a check that lands after Back has retired the
    // round keeps its verdict and schedules nothing. The timer then calls
    // `advance.current`, re-pointed after every render — the `next` it was
    // scheduled with closed over answers that did not yet hold the tap, and
    // on the last question that sent a sheet with a `-1` in it.
    expect(body).toMatch(/void reveal\(index, option, round\.current\.begin\(\)\);/);
    expect(body).toMatch(/if \(!isCurrent\(\)\) return;/);
    expect(body).toMatch(/void advance\.current\(\);/);
    expect(body).toMatch(/advance\.current = next;/);
    expect(body).not.toMatch(/setTimeout\([\s\S]{0,80}void next\(\)/);
    // A verdict dwells longer than a plain fill, and a fill is what a lost check gets.
    expect(body).toMatch(/answer !== null \? REVEAL_MS : FILL_MS/);
    const reveal = Number(source.match(/const REVEAL_MS = (\d+);/)?.[1]);
    const fill = Number(source.match(/const FILL_MS = (\d+);/)?.[1]);
    expect(reveal).toBeGreaterThan(fill);
  });

  it("retires the lock with the round, and holds Back while an advance is on its way", () => {
    // `retireRound` is the single teardown; the lock and `pending` are two
    // more things it has to clear, or Back onto a question would find it
    // already answered-and-locked with no tap to blame. Back is disabled
    // while pending because a swipe mid-dwell would leave the timer firing
    // `next()` off whichever question replaced this one.
    const teardown = body.match(/function retireRound\(\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";
    expect(teardown).toMatch(/locked\.current = null;/);
    expect(teardown).toMatch(/setPending\(false\);/);
    expect(teardown).toMatch(/clearTimeout\(advanceTimer\.current\)/);
    expect(teardown).toMatch(/round\.current\.bump\(\);/);
    expect(body).toMatch(/className="q-back" onClick=\{back\} disabled=\{busy \|\| pending\}/);
    // A parked question — answered, nothing moving it — is the only one with a button.
    expect(body).toMatch(/const parked = chosen >= 0 && !pending && !busy;/);
    expect(body).toMatch(/\{parked && \(/);
    expect(body).toMatch(/\{last \? copy\.submitButton : copy\.nextButton\}/);
  });

  it("bounds the check with a timeout, and a lost one costs the verdict and nothing else", () => {
    // A phone on a bad radio must not sit on a filled half. The failure is
    // caught where it is awaited, the answer stays null, and the plain fill
    // advances the question; the sheet is graded at the end either way.
    expect(body).toMatch(/AbortSignal\.timeout\(CHECK_TIMEOUT_MS\)/);
    expect(body).toMatch(/signal: checkTimeout\(\)/);
    const timeout = Number(source.match(/const CHECK_TIMEOUT_MS = (\d+);/)?.[1]);
    expect(timeout).toBeGreaterThanOrEqual(2000);
    expect(timeout).toBeLessThanOrEqual(10_000);
    const revealFn = body.match(/async function reveal\([\s\S]*?\n  \}/)?.[0] ?? "";
    expect(revealFn).toMatch(/let answer: number \| null = null;/);
    expect(revealFn).toMatch(/try \{\s*answer = \(await fetchCheck\(code, question, option\)\)\.answer;\s*\} catch \(e: unknown\) \{/);
    // A malformed 200 is a lost check too, not a verdict of `undefined`.
    expect(body).toMatch(/if \(!Number\.isInteger\(check\.answer\)\) throw/);
    // And the loss is counted, bucketed, since the server only ever sees the
    // limiter's refusals: a slow KV shows up nowhere else.
    expect(revealFn).toMatch(/trackEvent\("quiz_check_lost", \{ reason: lostCheckReason\(e\) \}\);/);
    const reasons = body.match(/function lostCheckReason\(e: unknown\): ([^{]+)\{/)?.[1] ?? "";
    for (const reason of ["timeout", "offline", "rate_limited", "server", "malformed"]) {
      expect(reasons).toContain(`"${reason}"`);
    }
  });

  it("does not charge or play a hint that lands after the half was tapped", () => {
    // `pick` does not retire the round — the verdict has to land on this
    // question — so a hint still in flight keeps a current token for the
    // whole dwell. Without the lock check it would be charged and start
    // under the answer the taker already has.
    expect(body).toMatch(/if \(!isCurrent\(\) \|\| locked\.current === question\) return;\s*if \(!paid\) \{/);
  });

  it("shows an answered question whose verdict never came as locked, and says so", () => {
    // A parked question with no verdict must not wear the "on its way"
    // tone or the question prompt: it reads as a question that will not
    // take a tap. `parked` decides both the tone and the seam line.
    expect(body).toMatch(/selected \? \(parked \? " is-locked" : " is-on"\) : ""/);
    expect(body).toMatch(/: parked\s*\? \{ text: copy\.revealPending, tone: "" \}/);
    expect(source).toMatch(/\.q-half\.is-locked \{/);
    expect(QUIZ_COPY.en.revealPending).not.toBe(QUIZ_COPY.zh.revealPending);
  });

  it("remembers the verdicts with the progress, and restores them only at the quiz's own length", () => {
    // A reload mid-dwell puts the question back with its verdict; the save
    // effect must depend on `revealed` or the last verdict is lost to the
    // reload that follows it. On restore, an entry from before the reveal
    // shipped (empty) or of another length is replaced with "not told".
    expect(body).toMatch(/saveQuizProgress\(\{[\s\S]*?\brevealed,[\s\S]*?\}\);/);
    expect(body).toMatch(/\}, \[view, phase, name, answers, revealed, index, hintsLeft\]\);/);
    expect(body).toMatch(/progress\.revealed\.length === quiz\.questionCount\s*\? progress\.revealed\s*: new Array<number>\(quiz\.questionCount\)\.fill\(-1\)/);
    expect(body).toMatch(/setRevealed\(new Array\(quiz\.questionCount\)\.fill\(-1\)\);/);
  });

  it("dropped the answer list from the result screen, and its copy with it", () => {
    // Every question said right or wrong as it was answered; the score is the
    // end. The three review strings left `QuizCopy` so a stale reference is
    // a compile error, not an empty line — and nothing in app/ or lib/ still
    // names them.
    expect(body).not.toMatch(/q-review/);
    for (const gone of ["reviewTitle", "reviewRight", "reviewMissed"]) {
      expect(body).not.toContain(gone);
      expect(gone in QUIZ_COPY.en).toBe(false);
      expect(gone in QUIZ_COPY.zh).toBe(false);
    }
    // And the two that replaced them are what the seam shows, keyed on the
    // verdict — one ladder for the words and the tone, so they cannot drift.
    expect(body).toMatch(/chosen === verdict\s*\?\s*\{ text: copy\.revealRight, tone: " is-live" \}\s*:\s*\{ text: copy\.revealWrong, tone: " is-wrong" \}/);
    expect(QUIZ_COPY.en.revealRight).not.toBe(QUIZ_COPY.en.revealWrong);
  });
});

describe("the verdict is painted on the pick, and wrong is red", () => {
  const source = read(CLIENT);
  const body = code(source);

  /** The `background` of one `.q-half.<state>` rule, as `[r, g, b]`. */
  function fill(state: string): [number, number, number] {
    const rule = source.match(new RegExp(`\\.q-half\\.${state} \\{([^}]*)\\}`));
    expect(rule, `.q-half.${state} rule`).not.toBeNull();
    const hex = rule![1].match(/background:\s*#([0-9a-f]{6})\b/i);
    expect(hex, `.q-half.${state} background`).not.toBeNull();
    const n = parseInt(hex![1], 16);
    return [n >> 16, (n >> 8) & 0xff, n & 0xff];
  }

  it("fills a wrong pick with a red that is red, not a dark tint of the unanswered tile", () => {
    // What shipped in 1.11.0 was `#2a1414`: on a `#111` page that is the
    // unanswered tile with a thin red edge, while the real song beside it
    // got the full Spotify green. Every tap ended with one bright green
    // tile and nothing red, which read as "always green". A wrong pick
    // has to be the saturated fill on the tile that was tapped.
    const [r, g, b] = fill("is-wrong");
    expect(r).toBeGreaterThanOrEqual(0xc0);
    expect(g).toBeLessThanOrEqual(0x70);
    expect(b).toBeLessThanOrEqual(0x70);
    // And it is a fill, so the badge and artist invert on it like the green.
    expect(source).toMatch(/\.q-half\.is-wrong \.q-check \{[^}]*background: #000;/);
  });

  it("keeps the green fill for a right pick and reveals the answer under a wrong one without it", () => {
    // Green means "you were right". The real song shown under a wrong pick
    // is the reveal, and it must not wear the same fill or the wrong
    // verdict reads as green — a green edge and the tick say which one it
    // was without stealing the verdict.
    expect(body).toMatch(/const right = verdict >= 0 && selected && i === verdict;/);
    expect(body).toMatch(/const answer = verdict >= 0 && !selected && i === verdict;/);
    expect(body).toMatch(/right \? " is-right" : wrong \? " is-wrong" : answer \? " is-answer"/);
    const [r, g, b] = fill("is-right");
    expect([r, g, b]).toEqual([0x1d, 0xb9, 0x54]);
    const reveal = source.match(/\.q-half\.is-answer \{([^}]*)\}/);
    expect(reveal).not.toBeNull();
    expect(reveal![1]).not.toMatch(/background:\s*#1DB954/i);
    expect(reveal![1]).toMatch(/border-color:\s*#1DB954/i);
  });
});
