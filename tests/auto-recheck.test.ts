// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUTO_RECHECK_CODE,
  AUTO_RECHECK_DELAY_MS,
  AUTO_RECHECK_MAX_WAIT_MS,
  autoRecheckAnswerStillWanted,
  autoRecheckStillWanted,
  ownSubmissionKey,
  readRecheckAnswer,
  shouldScheduleAutoRecheck,
} from "@/lib/auto-recheck";
import { RECHECK_MIN_AGE_MS } from "@/lib/playlist-cache";
import { playlistHelpTopic } from "@/lib/playlist-help";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const KEY = "own:https://open.spotify.com/playlist/7axyIwzJZsCS6M9PlwQp1U";

describe("the page's own recheck of a private refusal", () => {
  it("waits past the server's minimum age, or the 404 it means to go past is replayed", () => {
    expect(AUTO_RECHECK_DELAY_MS).toBeGreaterThan(RECHECK_MIN_AGE_MS);
  });

  it("is for the private refusal only", () => {
    expect(playlistHelpTopic(AUTO_RECHECK_CODE)).toBe("private");
    for (const c of ["playlist_editorial", "playlist_empty", "invalid_playlist_url", "spotify_rate_limited", "playlist_load_failed", undefined]) {
      expect(shouldScheduleAutoRecheck({ code: c, fromRecheck: false, notAsked: false, key: KEY, scheduledFor: null }), String(c)).toBe(false);
    }
    expect(shouldScheduleAutoRecheck({ code: AUTO_RECHECK_CODE, fromRecheck: false, notAsked: false, key: KEY, scheduledFor: null })).toBe(true);
  });

  it("is scheduled once per link, and never by a recheck's own refusal", () => {
    expect(shouldScheduleAutoRecheck({ code: AUTO_RECHECK_CODE, fromRecheck: false, notAsked: false, key: KEY, scheduledFor: KEY })).toBe(false);
    expect(shouldScheduleAutoRecheck({ code: AUTO_RECHECK_CODE, fromRecheck: true, notAsked: false, key: KEY, scheduledFor: null })).toBe(false);
    // Unless that recheck was answered from our cache: then Spotify was not asked.
    expect(shouldScheduleAutoRecheck({ code: AUTO_RECHECK_CODE, fromRecheck: true, notAsked: true, key: KEY, scheduledFor: null })).toBe(true);
    expect(shouldScheduleAutoRecheck({ code: AUTO_RECHECK_CODE, fromRecheck: true, notAsked: true, key: KEY, scheduledFor: KEY })).toBe(false);
    // A different link refused afterwards gets its own.
    expect(shouldScheduleAutoRecheck({ code: AUTO_RECHECK_CODE, fromRecheck: false, notAsked: false, key: "own:other", scheduledFor: KEY })).toBe(true);
  });

  it("fires only if the page is still where it was", () => {
    const at = { key: KEY, currentKey: KEY, rejectedKey: KEY, loading: false, singleMode: true, refusalShown: true, scheduledAt: 0, now: AUTO_RECHECK_DELAY_MS };
    expect(autoRecheckStillWanted(at)).toBe(true);
    expect(autoRecheckStillWanted({ ...at, currentKey: "own:edited" })).toBe(false);
    expect(autoRecheckStillWanted({ ...at, rejectedKey: null })).toBe(false);
    expect(autoRecheckStillWanted({ ...at, loading: true })).toBe(false);
    // The host moved to Mixed: the refusal on screen is not the form they are on.
    expect(autoRecheckStillWanted({ ...at, singleMode: false })).toBe(false);
    // A tab hidden past the cap: the check is dropped, not sent on return.
    expect(autoRecheckStillWanted({ ...at, now: AUTO_RECHECK_MAX_WAIT_MS })).toBe(true);
    expect(autoRecheckStillWanted({ ...at, now: AUTO_RECHECK_MAX_WAIT_MS + 1 })).toBe(false);
    // A roster error raised since: the box no longer shows the refusal it was for.
    expect(autoRecheckStillWanted({ ...at, refusalShown: false })).toBe(false);
  });

  it("drops an answer that is no longer the host's", () => {
    const at = { key: KEY, currentKey: KEY, rejectedKey: KEY, loading: false, singleMode: true, refusalShown: true };
    expect(autoRecheckAnswerStillWanted(at)).toBe(true);
    // The host's own request is in flight: its answer, not ours, decides the screen.
    expect(autoRecheckAnswerStillWanted({ ...at, loading: true })).toBe(false);
    expect(autoRecheckAnswerStillWanted({ ...at, singleMode: false })).toBe(false);
    expect(autoRecheckAnswerStillWanted({ ...at, currentKey: "own:edited" })).toBe(false);
    expect(autoRecheckAnswerStillWanted({ ...at, rejectedKey: null })).toBe(false);
    expect(autoRecheckAnswerStillWanted({ ...at, refusalShown: false })).toBe(false);
  });

  it("gives up on a hidden tab before the 404 it was scheduled for can expire", () => {
    // Past NOT_FOUND_TTL_SECONDS (10 min) the check would be a cold load; the
    // cache yields to pressure then too, but the cap keeps it rare.
    expect(AUTO_RECHECK_MAX_WAIT_MS).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  it("keys a submission one way, for the memo and the timer alike", () => {
    expect(ownSubmissionKey("https://open.spotify.com/playlist/x")).toBe("own:https://open.spotify.com/playlist/x");
  });

  it("says \"still private\" only when Spotify was asked", () => {
    expect(readRecheckAnswer(true, { tracks: [{ id: "a" }] })).toBe("found");
    expect(readRecheckAnswer(false, { code: "playlist_not_found" })).toBe("still_private");
    expect(readRecheckAnswer(false, { code: "playlist_not_found", replayed: true })).toBe("not_asked");
    // Only a literal true marks a replay; anything else is Spotify's own 404.
    expect(readRecheckAnswer(false, { code: "playlist_not_found", replayed: "true" })).toBe("still_private");
    // Anything else says nothing about the playlist.
    for (const [ok, body] of [
      [true, { tracks: [] }],
      [true, null],
      [false, { code: "spotify_rate_limited" }],
      [false, "<html>"],
      [false, null],
    ] as const) {
      expect(readRecheckAnswer(ok, body), JSON.stringify(body)).toBe("other");
    }
  });
});

describe("the setup page's wiring", () => {
  const body = code(read("app/page.tsx"));

  it("schedules from the refusal a request brought back, in the catch", () => {
    const start = body.slice(body.indexOf("async function handleStart("), body.indexOf("function scheduleAutoRecheck("));
    const caught = start.slice(start.indexOf("} catch (e: unknown) {"));
    const schedule = caught.indexOf("shouldScheduleAutoRecheck(");
    expect(schedule).toBeGreaterThan(0);
    expect(caught.slice(schedule, schedule + 400)).toMatch(/fromRecheck: recheck/);
    expect(caught.slice(schedule, schedule + 400)).toMatch(/notAsked: answer === "not_asked"/);
  });

  it("sends it as the literal \"auto\", and cancels a pending one on any Start", () => {
    const run = body.slice(body.indexOf("async function runAutoRecheck("));
    expect(run.slice(0, 900)).toMatch(/recheck: "auto"/);
    const start = body.slice(body.indexOf("async function handleStart("));
    // A Start that sends a request (or the button) cancels it; one the memo
    // answers does not — that host pressed the wrong button after fixing it.
    expect(start.slice(0, 700)).toMatch(/const memoWillAnswer =\s*!recheck && lastRejectedRef\.current\?\.key === ownSubmissionKey\(playlistUrl\);/);
    expect(start.slice(0, 700)).toMatch(/if \(!memoWillAnswer\) \{\s*cancelAutoRecheck\(\);/);
    // Start itself never sends "auto": the button is a person asking.
    expect(start.slice(0, start.indexOf("async function", 10))).not.toMatch(/"auto"/);
  });

  it("holds it while the tab is hidden", () => {
    const fn = body.slice(body.indexOf("function scheduleAutoRecheck("));
    expect(fn.slice(0, 1800)).toMatch(/document\.visibilityState === "visible"/);
    expect(fn.slice(0, 1800)).toMatch(/addEventListener\("visibilitychange"/);
  });

  // Value: protects=the page's own check only asks — it never starts a game, validates the form or counts a submission; fails_when=runAutoRecheck calls handleStart, saveGame, router.push or trackEvent; why_new=the check used to run the whole Start path and navigated under a host who was typing; seam=none; no_claim=runtime timer behaviour (source read; page not rendered)
  it("only asks: no game, no form validation, no submission", () => {
    const run = body.slice(body.indexOf("async function runAutoRecheck("), body.indexOf("async function handleMixedStart("));
    expect(run.length).toBeGreaterThan(200);
    for (const forbidden of [/handleStart\(/, /saveGame\(/, /router\.push\(/, /trackEvent\(/, /players_required/, /recordHostedStart\(/]) {
      expect(run, String(forbidden)).not.toMatch(forbidden);
    }
    // A found playlist clears the refusal and asks for Start instead.
    expect(run).toMatch(/setRecheckFoundKey\(key\)/);
    // The answer is checked against the page as it is when it lands.
    const after = run.slice(run.indexOf("await res.json()"));
    expect(after).toMatch(/autoRecheckAnswerStillWanted\(\{[\s\S]*loading: loadingRef\.current[\s\S]*singleMode: singleModeRef\.current[\s\S]*refusalShown: refusalShownRef\.current/);
  });

  // Value: protects=a check is asked at most once, and one that never went out is not spent; fails_when=cancel or an unsent drop keeps the key, or the memo cannot restore a dropped check; why_new=cycle 3 found the check lost for a host who cleared a name or pressed the button too soon; seam=none; no_claim=runtime timer behaviour (source read)
  it("gives the link back a check only where nothing asked", () => {
    // A cancel is the host's own request, which is that link's one ask: the
    // key stays, or "button, then memo Start" schedules a second call.
    const cancel = body.slice(body.indexOf("function cancelAutoRecheck("), body.indexOf("const collectsPlaylists ="));
    expect(cancel.length).toBeGreaterThan(50);
    expect(cancel.length).toBeLessThan(400);
    expect(cancel).not.toMatch(/autoRecheckForRef\.current = null/);
    // A button press our cache answered gives it back, before scheduling.
    const start = body.slice(body.indexOf("async function handleStart("), body.indexOf("function scheduleAutoRecheck("));
    const caught = start.slice(start.indexOf("} catch (e: unknown) {"));
    expect(caught).toMatch(/recheck && answer === "not_asked" && autoRecheckForRef\.current === submissionKey\) \{\s*autoRecheckForRef\.current = null;/);
    expect(caught.indexOf("autoRecheckForRef.current = null")).toBeLessThan(caught.indexOf("shouldScheduleAutoRecheck("));
    const fn = body.slice(body.indexOf("function scheduleAutoRecheck("));
    const drop = fn.slice(0, fn.indexOf("void runAutoRecheck(key)"));
    expect(drop).toMatch(/autoRecheckForRef\.current = null;/);
    // The memo's re-shown refusal restores one, but never stacks a second timer.
    const memo = start.slice(start.indexOf("rejected.key === submissionKey"), start.indexOf("setLoading(true)"));
    expect(memo).toMatch(/!autoRecheckTimerRef\.current &&\s*!autoRecheckVisibleRef\.current &&\s*shouldScheduleAutoRecheck\(/);
    expect(memo).toMatch(/scheduleAutoRecheck\(submissionKey\)/);
  });

  it("tells the host to press the button whenever its own check got no answer from Spotify", () => {
    const run = body.slice(body.indexOf("async function runAutoRecheck("), body.indexOf("async function handleMixedStart("));
    expect(run).toMatch(/answer === "still_private" \? \{ note: "auto_still_private", key \} : \{ note: "not_asked", key \}/);
    // And it gives up rather than hang on "Checking again…".
    expect(run).toMatch(/setTimeout\(\(\) => controller\.abort\(\), AUTO_RECHECK_TIMEOUT_MS\)/);
    expect(run).toMatch(/signal: controller\.signal/);
  });

  // Value: protects="press Start" shows for the found link only, on the single form, and is cleared by Start; fails_when=the line is keyed loosely or survives a link edit or a mode switch; why_new=no test pinned the render guard; seam=none; no_claim=visual layout (source read)
  it("says \"press Start\" for the found link only, on the single-playlist form", () => {
    expect(body).toMatch(/!failure && setupMode === "single" && recheckFoundKey === ownSubmissionKey\(playlistUrl\) && \(/);
    const start = body.slice(body.indexOf("async function handleStart("));
    expect(start.slice(0, 700)).toMatch(/setRecheckFoundKey\(null\)/);
  });

  // Value: protects=the timer compares the key the refusal was stored under; fails_when=the memo and the timer build the key two ways; why_new=a drift makes the check silently never fire; seam=none; no_claim=runtime timer behaviour (source read)
  it("compares the key the refusal was stored under", () => {
    expect(body).toMatch(/const submissionKey = ownSubmissionKey\(playlistUrl\);/);
    const fn = body.slice(body.indexOf("function scheduleAutoRecheck("));
    expect(fn.slice(0, 900)).toMatch(/currentKey: ownSubmissionKey\(playlistUrlRef\.current\)/);
    expect(body).not.toMatch(/`own:\$\{/);
  });

  // Value: protects=each note under the buttons reaches the screen; fails_when=the page stops passing the note or the component stops rendering it; why_new=only the copy's two languages were tested; seam=none; no_claim=visual layout (source read)
  it("shows the note for what the last check did", () => {
    // Every note is about one link, and shown only while the field holds it.
    expect(body).toMatch(/recheckNote && recheckNote\.key === ownSubmissionKey\(playlistUrl\)\s*\?\s*recheckNote\.note\s*:\s*null/);
    const assist = code(read("components/setup-assist.tsx"));
    expect(assist).toMatch(/<p className="recheck-note" aria-live="polite" aria-atomic="true">\s*\{note && !checking \? offer\.notes\[note\] : null\}/);
    // "Still private" from the button only when Spotify said so.
    expect(body).toMatch(/answer === "still_private"\) setRecheckNote\(\{ note: "still_private", key: submissionKey \}\)/);
  });
});
