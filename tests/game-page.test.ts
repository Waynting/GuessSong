// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PHONE_MEDIA_QUERY } from "@/lib/game-over";

/**
 * The game page's wiring, as far as the suite can see it.
 *
 * The rules live in `lib/` and are tested there (clip-start, clip-clock,
 * first-clip, track-queue, game-over, game-beacons). What cannot be tested
 * there is whether the page *asks* them — vitest cannot import a `.tsx`
 * module here — and every line below is a way the page could stop asking
 * with the build green and the desktop looking fine. Read the source, the way
 * tests/mobile.test.ts and tests/setup-pages.test.ts do.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** The source with its comments removed, so a rule named in prose does not pass for one in code. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const GAME = "app/game/page.tsx";
const source = read(GAME);
const body = code(source);

/** The body of `const name = useCallback(` … or `function name(` …, up to the next top-level member. */
function member(name: string): string {
  const start = body.search(new RegExp(`(?:const ${name} = useCallback\\(|function ${name}\\()`));
  expect(start, `no ${name} on the page`).toBeGreaterThan(-1);
  const rest = body.slice(start + 1);
  const next = rest.search(/\n  (?:const \w+ = use(?:Callback|Ref|State)|(?:async )?function \w+\(|useEffect\()/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("a refused play() cannot look like a playing clip", () => {
  it("has one way of asking the element for sound, and it is not a bare play()", () => {
    // There were four `audio.play().catch(() => {})`, each followed by
    // setPhase("playing") and the clip's timers. A refusal was swallowed and
    // the round counted down over silence.
    expect(body).not.toMatch(/\.play\(\)/);
    expect(body).not.toMatch(/\.catch\(\(\) => \{\}\)/);
    expect(body.match(/startPlayback\(/g) ?? []).toHaveLength(1);
    expect(member("requestSound")).toMatch(/startPlayback\(audio\)/);
  });

  it("sends all four call sites through the one ask", () => {
    expect(member("playClip")).toMatch(/requestSound\("play"\)/);
    expect(member("resumeClip")).toMatch(/requestSound\("resume"\)/);
    expect(member("replayClip")).toMatch(/requestSound\("replay"\)/);
    expect(member("handleAudioError")).toMatch(/requestSound\("repair"\)/);
  });

  it("starts the timers and the 'playing' phase from sound, and from nowhere else", () => {
    // If either moves back beside the ask, a clip that is refused or still
    // loading counts its window down again, and the buzzer round opens on
    // every phone over silence.
    expect(body.match(/startClipTimers\(\)/g) ?? []).toHaveLength(1);
    expect(body.match(/setPhase\("playing"\)/g) ?? []).toHaveLength(1);
    const started = member("soundStarted");
    expect(started).toMatch(/startClipTimers\(\)/);
    expect(started).toMatch(/setPhase\("playing"\)/);
    expect(started).toMatch(/afterSoundStarted\(/);
  });

  it("listens for the sound itself — `playing`, which `play` is not", () => {
    const audio = body.match(/<audio\b[\s\S]*?\/>/)?.[0] ?? "";
    expect(audio).toMatch(/onPlaying=\{soundStarted\}/);
    expect(audio).toMatch(/onError=\{handleAudioError\}/);
  });

  it("answers a refusal through the round token and the phase as it is now", () => {
    // The rejection is async work like any other: it can land after Skip,
    // Reveal or End Game, and what it writes then belongs to another card.
    const ask = member("requestSound");
    expect(ask).toMatch(/stillThisRound: roundsRef\.current\.begin\(\)/);
    expect(ask).toMatch(
      /afterPlayRejected\(\{\s*result,\s*phase: phaseRef\.current,\s*currentRound: request\.stillThisRound\(\),\s*standing,?\s*\}\)/
    );
    expect(ask).toMatch(/if \(verdict\.act === "ignore"\) return;/);
    // And an answer for a request that has been dropped or replaced belongs
    // to nobody — sound included, which would start the newer ask's timers.
    expect(ask).toMatch(/const standing = soundRequestRef\.current === request;/);
    expect(ask).toMatch(/if \(standing\) soundStarted\(\);/);
  });

  it("drops the pending request before it pauses, in both places that pause", () => {
    // The pause is what rejects a play() still pending.
    for (const name of ["stopClip", "pauseClip"]) {
      const fn = member(name);
      const drop = fn.indexOf("soundRequestRef.current = null");
      const pause = fn.search(/\.pause\(\)/);
      expect(drop, `${name} never drops the request`).toBeGreaterThan(-1);
      expect(pause, `${name} never pauses`).toBeGreaterThan(-1);
      expect(drop, `${name} pauses first`).toBeLessThan(pause);
    }
  });

  it("tells the host to tap again, from the copy in lib/", () => {
    expect(body).toMatch(/\{CLIP_COPY\.blockedPlay\}/);
    expect(body).toMatch(/\{CLIP_COPY\.blockedResume\}/);
  });

  it("keeps playClip's two guards after its await, in their order", () => {
    // The round token first, then the phase: Reveal moves the phase without
    // ending the round, so neither can stand in for the other.
    const play = member("playClip");
    const awaited = play.indexOf("await fetchPreview(");
    const token = play.indexOf("if (!stillThisRound()) return;");
    const phase = play.indexOf('if (phaseRef.current !== "waiting") return;');
    expect(awaited).toBeGreaterThan(-1);
    expect(token).toBeGreaterThan(awaited);
    expect(phase).toBeGreaterThan(token);
    expect(play.indexOf("const stillThisRound = roundsRef.current.begin();")).toBeLessThan(awaited);
  });
});

describe("retireRound is still the one teardown", () => {
  it("stops the clip, bumps the token, hands the src back and clears the round's affordances, in that order", () => {
    const teardown = member("retireRound");
    const order = [
      'settleFirstClip("abandoned")',
      "stopClip()",
      "roundsRef.current.bump()",
      "releaseClip()",
      "endBusy()",
      "setClipMiss(null)",
      "setPlayBlocked(false)",
    ].map((step) => teardown.indexOf(step));
    expect(order.every((at) => at > -1), `a step is missing: ${order.join(",")}`).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("is what Next Track and End Game both go through", () => {
    expect(member("nextTrack")).toMatch(/retireRound\(\)/);
    expect(member("endGame")).toMatch(/retireRound\(\)/);
    expect(body.match(/roundsRef\.current\.bump\(\)/g) ?? []).toHaveLength(1);
  });

  it("hands the src back with removeAttribute, never an empty string", () => {
    expect(member("releaseClip")).toMatch(/removeAttribute\("src"\)/);
    expect(body).not.toMatch(/\.src = ""/);
  });
});

describe("unavailable is not absent on screen", () => {
  it("shows the song's sentence for one and ours for the other", () => {
    expect(body).toMatch(/clipMiss === "unavailable" \? CLIP_COPY\.unavailable : CLIP_COPY\.absent/);
    // And nowhere is the old sentence written into the page by hand.
    expect(body).not.toContain("No audio for this track");
  });

  it("offers Retry for unavailable only, and sends it through playClip's round token", () => {
    const controls = member("skipControls");
    expect(controls).toMatch(/const canRetry = clipMiss === "unavailable" && !previewLoading;/);
    expect(controls).toMatch(/\{canRetry && \([\s\S]*?onClick=\{playClip\}[\s\S]*?CLIP_COPY\.retry/);
    expect(member("playClip")).toMatch(/const stillThisRound = roundsRef\.current\.begin\(\);/);
  });

  it("never remembers an unavailable answer", () => {
    // `previewCache` holds settled answers only. One write that skips the
    // guard turns a throttled minute into a track that is silent all game —
    // and, now, into a track dropped from the queue.
    const writes = [...body.matchAll(/([^\n]*)previewCache\.current\[[^\]]+\] = ([^;]+);/g)];
    expect(writes.length).toBeGreaterThanOrEqual(3);
    // Every write is of an answer's own URL, never a bare null…
    for (const [line, , value] of writes) expect(value, line).toBe("result.previewUrl");
    // …and every one is guarded on the line it is written, bar the repair's,
    // which sits under its function's `if (!result.previewUrl)` bail-out.
    const bare = writes.filter(
      ([, before]) => !/if \((isPreviewSettled\(result\.status\)|result\.previewUrl)\) $/.test(before)
    );
    expect(bare).toHaveLength(1);
    const repair = member("handleAudioError");
    const bailOut = repair.search(/if \(!result\.previewUrl\) \{[^}]*return;\s*\}/);
    expect(bailOut).toBeGreaterThan(-1);
    expect(repair.lastIndexOf("previewCache.current[track.id] = result.previewUrl;")).toBeGreaterThan(bailOut);
    expect(member("playClip")).toMatch(
      /if \(isPreviewSettled\(result\.status\)\) previewCache\.current\[track\.id\] = result\.previewUrl;/
    );
  });

  it("does not spend a track's one repair on a refresh that was never made", () => {
    expect(member("handleAudioError")).toMatch(
      /if \(result\.status !== "unavailable"\) refreshedTracks\.current\.add\(track\.id\);/
    );
  });
});

describe("an order payload never reaches the prefetch", () => {
  it("sends it to /order before setTracks, so the batch effect cannot run", () => {
    // The prefetch keys on `tracks.length`; a mode check after `setTracks`
    // would spend a batch of lookups on a game that never presses Play.
    const mount = body.match(/const data = loadGame\(\);[\s\S]*?setTracks\(data\.tracks\);/)?.[0] ?? "";
    expect(mount).toMatch(/if \(data\.mode === "order"\) \{ router\.replace\("\/order"\); return; \}/);
    expect(mount.indexOf('data.mode === "order"')).toBeLessThan(mount.indexOf("setTracks(data.tracks)"));
  });
});

describe("known-silent upcoming tracks are skipped", () => {
  it("asks the rule with where the host is now, not where they were when the batch was sent", () => {
    expect(body).toMatch(
      /dropSilentUpcoming\(\s*tracksRef\.current,\s*currentIndexRef\.current,\s*previewCache\.current\s*\)/
    );
    // The ref moves with Next Track rather than a render behind it.
    expect(member("nextTrack")).toMatch(/currentIndexRef\.current = currentIndex \+ 1;/);
  });

  it("asks for the batch once per page, so a drop cannot re-send what was throttled", () => {
    // The effect depends on `tracks` and the drop changes `tracks`. Without
    // the guard every drop re-asks exactly the tracks that were unavailable.
    const effect = body.match(/useEffect\(\(\) => \{\s*if \(tracks\.length === 0[\s\S]*?\}, \[tracks\]\);/)?.[0] ?? "";
    expect(effect).toMatch(/if \(tracks\.length === 0 \|\| prefetchAskedRef\.current\) return;/);
    expect(effect).toMatch(/prefetchAskedRef\.current = true;/);
    expect(effect.match(/fetchPreviewBatch\(/g) ?? []).toHaveLength(1);
    expect(body.match(/fetchPreviewBatch\(/g) ?? []).toHaveLength(1);
  });

  it("says how many, once, under the Play prompt", () => {
    expect(body).toMatch(/const skippedLine = silentSkippedLine\(silentSkipped\);/);
    expect(body.match(/\{skippedLine && /g) ?? []).toHaveLength(1);
  });

  it("builds the mix list and the taste card from the pool, not the queue", () => {
    // A contributor whose songs all lacked a clip is still someone whose
    // playlist made the pool. From the queue they would be reported as
    // having had none of it make the round.
    expect(member("copyMixList")).toMatch(/tracks: pool,/);
    expect(member("downloadTasteCard")).toMatch(/buildTasteCard\(pool, roundHistory\)/);
    expect(body).toMatch(/setTracks\(data\.tracks\);\s*setPool\(data\.tracks\);/);
    expect(body.match(/setPool\(/g) ?? []).toHaveLength(1);
  });

  it("reports the queue as played, and what was taken out of it", () => {
    const finished = member("trackGameFinished");
    expect(finished).toMatch(/total_tracks: tracks\.length,/);
    expect(finished).toMatch(/silentSkipped > 0 \? \{ silent_skipped: silentSkipped \} : \{\}/);
  });
});

describe("the game's beacons", () => {
  it("sends the host kind and the layout with the end, under the once-per-game guard", () => {
    const finished = member("trackGameFinished");
    expect(finished).toMatch(/if \(finishedTrackedRef\.current\) return;/);
    expect(finished).toMatch(/host: hostKindRef\.current,/);
    expect(finished).toMatch(/const layout = readGameScreen\(\);/);
    expect(finished).toMatch(/countRoundsPlayed\(currentIndex, phase\)/);
  });

  it("reads the host kind once, on mount, from the stored count", () => {
    expect(body).toMatch(/const hostGames = getHostGameCount\(\);\s*hostKindRef\.current = hostKindOf\(hostGames\);/);
    expect(body.match(/getHostGameCount\(\)/g) ?? []).toHaveLength(1);
  });

  it("leaves on pagehide, and never on visibilitychange", () => {
    // A phone that locks mid-party hides the tab. That is not leaving.
    expect(body).toMatch(/window\.addEventListener\("pagehide", onPageHide\)/);
    expect(body).toMatch(/window\.removeEventListener\("pagehide", onPageHide\)/);
    expect(body).not.toMatch(/visibilitychange/);
    // Nor on the two events that cost a page its place in the back/forward
    // cache just by being listened to.
    expect(body).not.toMatch(/addEventListener\("(?:before)?unload"/);
  });

  it("counts a leave once, only for an unfinished game, with the end beacon's arithmetic", () => {
    const leave = member("reportLeave");
    expect(leave).toMatch(/if \(leftRef\.current\) return;/);
    expect(leave).toMatch(/if \(tracksRef\.current\.length === 0\) return;/);
    expect(leave).toMatch(/if \(phaseRef\.current === "finished"\) return;/);
    expect(leave).toMatch(/countRoundsPlayed\(currentIndexRef\.current, phaseRef\.current\)/);
    expect(body.match(/reportGameLeft\(/g) ?? []).toHaveLength(1);
  });

  it("sends the once-per-game beacons from a game's first page only", () => {
    // A reload is round one again with no start beacon. Its first clip and
    // its leave would be a second entry for one game in `games`.
    expect(member("settleFirstClip")).toMatch(/firstPageRef\.current === false/);
    expect(member("reportLeave")).toMatch(/if \(firstPageRef\.current === false\) return;/);
    expect(body).toMatch(/if \(firstPageRef\.current === null\) \{\s*firstPageRef\.current = claimFirstPage\(/);
    expect(body.match(/reportFirstClip\(/g) ?? []).toHaveLength(1);
  });

  it("arms the first clip from the Play press, with the path the press took", () => {
    expect(member("playClip")).toMatch(/firstClipRef\.current\.press\(firstClipPath\(cached\)\);/);
    expect(body.match(/firstClipRef\.current\.press\(/g) ?? []).toHaveLength(1);
  });

  it("settles the first clip with each of the six outcomes, somewhere", () => {
    for (const outcome of ["played", "rejected", "error", "abandoned"]) {
      expect(body, outcome).toContain(`settleFirstClip("${outcome}")`);
    }
    expect(body).toMatch(/settleFirstClip\(missReason === "unavailable" \? "unavailable" : "no_audio"\)/);
  });
});

describe("the Game Over screen", () => {
  it("renders the QR only where the rule says to, so a phone never reports its impression", () => {
    // The impression is reported from an effect inside the component, so
    // hiding it with CSS would keep counting a surface nobody was shown.
    expect(body.match(/<LoopQr\b/g) ?? []).toHaveLength(1);
    expect(body).toMatch(/\{onward === "qr" && <LoopQr \/>\}/);
    expect(body).toMatch(/const onward = gameOverOnward\(screen\);/);
    expect(body).not.toMatch(/reportLoopImpression/);
    expect(code(read("components/loop-qr.tsx"))).toMatch(/reportLoopImpression\(surface\)/);
  });

  it("gives the phone a link to Mixed Playlist Mode, from the constants in lib/", () => {
    expect(body).toMatch(
      /\{onward === "mixed_link" && \(\s*<a className="next-game-link" href=\{MIXED_SETUP_HREF\} onClick=\{openMixedSetup\}>\s*\{MIXED_NEXT_GAME_LABEL\}/
    );
    expect(body).not.toContain("mode=mixed");
  });

  it("learns the layout in an effect, from the query the stylesheet uses", () => {
    expect(body).toMatch(/useState<GameScreen \| null>\(null\)/);
    expect(body).toMatch(/window\.matchMedia\(PHONE_MEDIA_QUERY\)/);
    // One breakpoint in two languages. If they drift, a tablet in the gap
    // gets the phone's stylesheet with the desktop's QR.
    expect(source).toContain(`@media ${PHONE_MEDIA_QUERY}`);
    expect(source.match(/@media \(max-width: \d+px\)/g) ?? []).toEqual([`@media ${PHONE_MEDIA_QUERY}`]);
  });

  it("counts both taps before it navigates, and leaves Play Again going home", () => {
    const again = member("playAgain");
    expect(again).toMatch(/reportGameOverTap\("play_again", screen\);\s*router\.push\("\/"\);/);
    const mixed = member("openMixedSetup");
    expect(mixed.indexOf('reportGameOverTap("mixed", screen)')).toBeGreaterThan(-1);
    expect(mixed.indexOf('reportGameOverTap("mixed", screen)')).toBeLessThan(
      mixed.indexOf("router.push(MIXED_SETUP_HREF)")
    );
  });

  it("makes the link a thumb-sized target that can wrap on a narrow phone", () => {
    const rule = source.match(/^\s*\.next-game-link\s*\{([^}]*)\}/m)?.[1] ?? "";
    const height = Number(rule.match(/min-height:\s*(\d+)px/)?.[1] ?? 0);
    expect(height).toBeGreaterThanOrEqual(44);
    expect(rule).toMatch(/flex-shrink:\s*0/);
    expect(rule).not.toMatch(/white-space:\s*nowrap/);
  });

  it("keeps the scoreboard the one thing on the screen that gives way", () => {
    // Everything under the scoreboard refuses to shrink and the scoreboard
    // agrees to — down to a floor of rows, never to 0px. Past that floor the
    // overlay itself scrolls: on a 375x667 phone with the install card and
    // the mix fallback up, a 0px floor in an unscrollable overlay hid 2nd
    // place and below with nothing to scroll.
    const board = source.match(/^\s*\.final-scoreboard\s*\{([^}]*)\}/m)?.[1] ?? "";
    expect(board).toMatch(/flex:\s*1 1 0/);
    const floor = Number(board.match(/min-height:\s*(\d+)px/)?.[1] ?? 0);
    expect(floor).toBeGreaterThanOrEqual(2 * 44);
    const overlay = source.match(/^\s*\.finished-overlay\s*\{([^}]*)\}/m)?.[1] ?? "";
    expect(overlay).toMatch(/overflow-y:\s*auto/);
    expect(overlay).not.toMatch(/overflow:\s*hidden/);
    for (const cls of [".btn-lg", ".finished-secondary", ".next-game-link", ".install-cta"]) {
      const rule = source.match(new RegExp(`^\\s*${cls.replace(".", "\\.")}\\s*\\{([^}]*)\\}`, "m"))?.[1] ?? "";
      expect(rule, cls).toMatch(/flex-shrink:\s*0/);
    }
  });
});

describe("an award reaches the row it names", () => {
  it("resolves every award through scoreboardName before marking the round scored", () => {
    // awardPoint compared p.name === playerName exactly while the roster merge
    // folded case, so a buzz from "amy" against the scoreboard's "Amy" was
    // announced as +3 and scored nobody.
    for (const name of ["awardPoint", "awardAlbumPoint", "awardSourcePoint"]) {
      const fn = member(name);
      const resolve = fn.indexOf("scoreboardName(players,");
      expect(resolve, name).toBeGreaterThan(-1);
      expect(fn.indexOf("Awarded(true)"), name).toBeGreaterThan(resolve);
    }
  });
});

describe("a round reaches the history the same way from Next Track and End Game", () => {
  it("records through closeRoundEntry from both paths, and nowhere else", () => {
    // End Game used to append nothing, so a source point awarded on the round
    // on screen vanished from the summary and the taste card.
    expect(member("nextTrack")).toMatch(/recordRound\("next"\)/);
    expect(member("endGame")).toMatch(/recordRound\("end"\)/);
    expect(member("recordRound")).toMatch(/closeRoundEntry\(/);
    expect(member("recordRound")).toMatch(/revealed: phase === "revealed"/);
    expect(body.match(/setRoundHistory\(\(/g) ?? []).toHaveLength(1);
  });
});
