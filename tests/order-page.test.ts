// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PHONE_MEDIA_QUERY } from "@/lib/game-over";

/**
 * The order page's wiring, as far as the suite can see it.
 *
 * The rules are in `lib/order-game.ts` and tested there. What cannot be
 * tested there is whether the page asks them, and — the whole reason the
 * page exists — whether it has stayed clear of the preview path. Read the
 * source, the way tests/game-page.test.ts does.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** The source with its comments removed, so a rule named in prose does not pass for one in code. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** The body of one CSS rule from a <style> template. */
function rule(css: string, selector: string): string {
  const re = new RegExp(`^\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m");
  const m = css.match(re);
  expect(m, `no rule for ${selector}`).not.toBeNull();
  return m![1];
}

/** The `@media (max-width: 768px) { ... }` block, braces matched. */
function phoneBlock(css: string): string {
  const at = css.indexOf("@media (max-width: 768px)");
  expect(at, "no phone block").toBeGreaterThan(-1);
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let j = open; j < css.length; j++) {
    if (css[j] === "{") depth++;
    else if (css[j] === "}" && --depth === 0) return css.slice(open + 1, j);
  }
  throw new Error("unbalanced braces");
}

const ORDER = "app/order/page.tsx";
const SETUP = "app/page.tsx";
const source = read(ORDER);
const body = code(source);

/** The body of `const name = useCallback(` … or `function name(` …, up to the next top-level member. */
function member(name: string): string {
  const start = body.search(new RegExp(`(?:const ${name} = useCallback\\(|(?:async )?function ${name}\\()`));
  expect(start, `no ${name} on the page`).toBeGreaterThan(-1);
  const rest = body.slice(start + 1);
  const next = rest.search(/\n  (?:const \w+ = use(?:Callback|Ref|State)|(?:async )?function \w+\(|useEffect\()/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("the order page plays no audio", () => {
  it("never imports the preview client, renders no audio element, and names no preview route", () => {
    // This is the mode's reason to exist: a cold game of the guess mode is
    // up to five upstream calls per track against sources that throttle the
    // whole deployment. One import of lib/preview-client.ts here, and the
    // page would be spending that budget on a game that never presses Play.
    expect(source).not.toMatch(/from "@\/lib\/preview-client"/);
    expect(body).not.toMatch(/preview-client|fetchPreview|fetchPreviewBatch|previewCache|previewUrl/);
    expect(body).not.toMatch(/<audio\b/);
    expect(body).not.toMatch(/\/api\/preview/);
    expect(body).not.toMatch(/\.play\(\)/);
  });

  it("sends a guess payload to /game before it reads any of it", () => {
    const mount = body.match(/const data = loadGame\(\);[\s\S]*?setRounds\(/)?.[0] ?? "";
    expect(mount).toMatch(/if \(data\.mode !== "order"\) \{ router\.replace\("\/game"\); return; \}/);
    expect(mount.indexOf('data.mode !== "order"')).toBeLessThan(mount.indexOf("buildOrderRounds("));
  });

  it("deals from the stored list through lib/order-game, and refuses a list that deals nothing", () => {
    // The deal is derived, not stored, so a reload deals the same game.
    expect(body).toMatch(/const built = buildOrderRounds\(data\.tracks\);/);
    expect(body).toMatch(/if \(built\.rounds\.length === 0\) \{ router\.push\("\/"\); return; \}/);
    expect(body).toMatch(/const cards = isRevealed && round \? trueOrder\(round\) : arranged;/);
    expect(body.match(/buildOrderRounds\(/g) ?? []).toHaveLength(1);
  });

  it("never names a year on a face-down card: cleaned title, album only after the reveal", () => {
    expect(body).toMatch(/<p className="order-title">\{displayTitle\(t\.name\)\}<\/p>/);
    expect(body).toMatch(/\{isRevealed && t\.albumName && <p className="order-album">/);
    expect(body).not.toMatch(/round_completed/);
  });

  it("keeps the host the judge: two awards, both through scoreboardName, one each per round", () => {
    for (const name of ["awardExact", "awardOldest"]) {
      const fn = member(name);
      const resolve = fn.indexOf("scoreboardName(players,");
      expect(resolve, name).toBeGreaterThan(-1);
      expect(fn.indexOf("Winner(playerName)"), name).toBeGreaterThan(resolve);
    }
    expect(member("awardExact")).toMatch(/if \(exactWinner !== null\) return;/);
    expect(member("awardOldest")).toMatch(/if \(oldestWinner !== null\) return;/);
    expect(body).toMatch(/score: p\.score \+ ORDER_EXACT_POINTS/);
    expect(body).toMatch(/score: p\.score \+ ORDER_OLDEST_POINTS/);
    expect(body).not.toMatch(/score \+ \d/);
  });
});

describe("the order page's beacons", () => {
  it("claims the first page and reads the host kind once, on mount, from the stored count", () => {
    expect(body).toMatch(/const hostGames = getHostGameCount\(\);\s*hostKindRef\.current = hostKindOf\(hostGames\);/);
    expect(body.match(/getHostGameCount\(\)/g) ?? []).toHaveLength(1);
    expect(body).toMatch(/if \(firstPageRef\.current === null\) \{\s*firstPageRef\.current = claimFirstPage\(/);
  });

  it("sends the end with mode: \"order\" under the once-per-game guard, with this page's arithmetic", () => {
    const finished = member("trackGameFinished");
    expect(finished).toMatch(/if \(finishedTrackedRef\.current\) return;/);
    expect(finished).toMatch(/host: hostKindRef\.current,/);
    expect(finished).toMatch(/const layout = readGameScreen\(\);/);
    expect(finished).toMatch(/mode: "order",/);
    expect(finished).toMatch(/game_mode: "order",/);
    expect(finished).toMatch(/orderRoundsPlayed\(currentIndex, phase\)/);
    expect(body).not.toMatch(/countRoundsPlayed/);
    // Whether the round still face down had been touched, for the round-zero
    // split (`order_bounce:ended`). The shared screen's drag, as closeRound's.
    expect(finished).toMatch(/\.\.\.\(buzzerRoom \? \{\} : \{ arranged: hostArranged\(arrangement, currentIndex\) \}\),/);
    // The link's denominator: the end says whether this Game Over draws it.
    expect(finished).toMatch(/linkDrawn: gameOverOnward\(layout, players\.length\)\.mixedLink,/);
  });

  it("reports a round's verdict once, from the one place a revealed round closes", () => {
    const close = member("closeRound");
    // Two calls, both in closeRound and on either side of one return: a
    // round on the phones, or the shared screen's.
    expect(body.match(/reportOrderRound\(/g) ?? []).toHaveLength(2);
    expect(close.match(/reportOrderRound\(/g) ?? []).toHaveLength(2);
    expect(close).toMatch(/if \(phase !== "revealed"\) return;/);
    expect(close).toMatch(
      /reportOrderRound\(\s*orderVerdict\(\{ exact: exactWinner !== null, oldest: oldestWinner !== null \}\),/
    );
    // The phones' round: the best answer for order_round, no `arranged`, and
    // its own beacon only when a phone was in play.
    expect(close).toMatch(
      /if \(phoneRound\?\.round === currentIndex\) \{\s*reportOrderRound\(roomVerdict\(phoneRound\.reveal\), currentIndex \+ 1\);\s*if \(phoneRound\.coverage\) \{\s*reportOrderPhoneRound\(currentIndex \+ 1, phoneRound\.coverage, phoneVerdictCounts\(phoneRound\.reveal\)\);\s*\}\s*return;/
    );
    expect(body.match(/reportOrderPhoneRound\(/g) ?? []).toHaveLength(1);
    expect(member("nextRound")).toMatch(/closeRound\(\)/);
    expect(member("endGame")).toMatch(/closeRound\(\)/);
  });

  it("leaves on pagehide, never on visibilitychange, once, first page only, with the end's arithmetic", () => {
    expect(body).toMatch(/window\.addEventListener\("pagehide", onPageHide\)/);
    expect(body).toMatch(/window\.removeEventListener\("pagehide", onPageHide\)/);
    expect(body).not.toMatch(/visibilitychange/);
    expect(body).not.toMatch(/addEventListener\("(?:before)?unload"/);
    const leave = member("reportLeave");
    expect(leave).toMatch(/if \(leftRef\.current\) return;/);
    expect(leave).toMatch(/if \(roundCountRef\.current === 0\) return;/);
    expect(leave).toMatch(/if \(phaseRef\.current === "finished"\) return;/);
    expect(leave).toMatch(/if \(firstPageRef\.current === false\) return;/);
    expect(leave).toMatch(/orderRoundsPlayed\(currentIndexRef\.current, phaseRef\.current\)/);
    expect(leave).toMatch(/setupSourceRef\.current,\s*"order",/);
    expect(body.match(/reportGameLeft\(/g) ?? []).toHaveLength(1);
    // The leave runs off `pagehide`, so `arranged` is read from a mirror of
    // the same `arrangement` state the End Game beacon reads — one source — and
    // a buzzer room sends none, as closeRound sends none for a phone round.
    expect(body).toMatch(/const arrangementRef = useRef\(arrangement\);\s*arrangementRef\.current = arrangement;/);
    expect(body).toMatch(/const buzzerRoomRef = useRef\(false\);\s*buzzerRoomRef\.current = buzzerRoom !== null;/);
    expect(leave).toMatch(
      /const arranged = buzzerRoomRef\.current\s*\?\s*undefined\s*:\s*hostArranged\(arrangementRef\.current, currentIndexRef\.current\);/
    );
    expect(leave).toMatch(/gameScored\(playersRef\.current\),\s*arranged,\s*playlistKindRef\.current\s*\);/);
    // One predicate, in lib/: the page never spells "moved" itself.
    expect(leave).not.toMatch(/\.moved\b/);
    expect(body.match(/hostArranged\(/g) ?? []).toHaveLength(4);
    expect(body).not.toMatch(/arrangement\?\.round === currentIndex && arrangement\.moved/);
  });

  it("never calls recordHostedStart or the first-clip reporter — a start is the setup page's, a clip is not here", () => {
    expect(body).not.toMatch(/recordHostedStart|reportGameStart|reportFirstClip|bumpHostGameCount/);
  });
});

describe("the order page's Game Over", () => {
  it("renders the QR only where the rule says to, so a phone never reports its impression", () => {
    expect(body.match(/<LoopQr\b/g) ?? []).toHaveLength(1);
    expect(body).toMatch(/\{onward\.qr && <LoopQr \/>\}/);
    expect(body).toMatch(/const onward = gameOverOnward\(screen, players\.length\);/);
    expect(body).not.toMatch(/reportLoopImpression/);
  });

  it("gives the phone the Mixed link from the constants in lib/, and counts both taps before navigating", () => {
    expect(body).toMatch(
      /\{onward\.mixedLink && \(\s*<a className="next-game-link" href=\{MIXED_SETUP_HREF\} onClick=\{openMixedSetup\}>\s*\{MIXED_NEXT_GAME_LABEL\}/
    );
    expect(body).not.toContain("mode=mixed");
    expect(member("playAgain")).toMatch(/reportGameOverTap\("play_again", screen\);\s*router\.push\("\/"\);/);
    const mixed = member("openMixedSetup");
    expect(mixed.indexOf('reportGameOverTap("mixed", screen)')).toBeLessThan(mixed.indexOf("router.push(MIXED_SETUP_HREF)"));
  });

  it("learns the layout in an effect, from the one query the stylesheet uses", () => {
    expect(body).toMatch(/useState<GameScreen \| null>\(null\)/);
    expect(body).toMatch(/window\.matchMedia\(PHONE_MEDIA_QUERY\)/);
    expect(source).toContain(`@media ${PHONE_MEDIA_QUERY}`);
    expect(source.match(/@media \(max-width: \d+px\)/g) ?? []).toEqual([`@media ${PHONE_MEDIA_QUERY}`]);
  });

  it("keeps the scoreboard the one thing on the screen that gives way", () => {
    const board = rule(source, ".final-scoreboard");
    expect(board).toMatch(/flex:\s*1 1 0/);
    expect(Number(board.match(/min-height:\s*(\d+)px/)?.[1] ?? 0)).toBeGreaterThanOrEqual(2 * 44);
    const overlay = rule(source, ".finished-overlay");
    expect(overlay).toMatch(/overflow-y:\s*auto/);
    expect(overlay).toMatch(/env\(safe-area-inset-bottom\)/);
    for (const cls of [".btn-lg", ".finished-secondary", ".next-game-link"]) {
      expect(rule(source, cls), cls).toMatch(/flex-shrink:\s*0/);
    }
    expect(Number(rule(source, ".next-game-link").match(/min-height:\s*(\d+)px/)?.[1] ?? 0)).toBeGreaterThanOrEqual(44);
  });

  it("builds the mix list from the stored pool, and names the mode on the result card", () => {
    expect(member("copyMixList")).toMatch(/tracks: pool,/);
    expect(member("downloadResultImage")).toMatch(/subtitle: `Order by year · \$\{playlistName\}`/);
  });
});

describe("the order page fits the phone it is played on", () => {
  const phone = phoneBlock(source);

  it("lets the main column shrink below the top bar's contents", () => {
    const columns = [...source.matchAll(/grid-template-columns:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(columns.length).toBeGreaterThanOrEqual(2);
    for (const value of columns) {
      expect(value, value).not.toMatch(/(^|\s)1fr(\s|$)/);
      expect(value, value).toMatch(/minmax\(0,\s*1fr\)/);
    }
    expect(rule(source, ".top-bar")).toMatch(/min-width:\s*0/);
    expect(rule(source, ".playlist-name")).toMatch(/min-width:\s*0/);
    expect(rule(source, ".order-card")).toMatch(/min-width:\s*0/);
  });

  it("refuses pull-to-refresh and keeps the screen awake for the whole game", () => {
    expect(source).toMatch(/html,\s*body\s*\{[^}]*overscroll-behavior-y:\s*none/);
    expect(rule(source, ".main-area")).toMatch(/overscroll-behavior:\s*contain/);
    expect(body).toMatch(/useScreenWakeLock\(rounds\.length > 0\)/);
  });

  it("turns the scoreboard into one sideways row and pads it for the home indicator", () => {
    expect(rule(phone, ".sidebar")).toMatch(/max-height:\s*none/);
    expect(rule(phone, ".sidebar")).toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom\)/);
    const list = rule(phone, ".score-list");
    expect(list).toMatch(/display:\s*flex/);
    expect(list).toMatch(/overflow-x:\s*auto/);
    expect(rule(phone, ".score-row")).toMatch(/flex:\s*0 0 auto/);
    expect(rule(phone, ".sidebar-header")).toMatch(/display:\s*none/);
  });

  it("does not let a long press on a cover open the image sheet", () => {
    const art = rule(source, ".order-art");
    expect(art).toMatch(/-webkit-touch-callout:\s*none/);
    expect(art).toMatch(/pointer-events:\s*none/);
    expect(body).toMatch(/className="order-art"\s*draggable=\{false\}/);
  });

  it("keeps Next Round on screen on a short phone, however many players there are", () => {
    // 375×667 with four players ran the reveal ~60px past the fold.
    const at = phone.indexOf("@media (max-height: 700px)");
    expect(at, "no short-phone block").toBeGreaterThan(-1);
    const next = rule(phone.slice(at), ".btn-primary.next");
    expect(next).toMatch(/position:\s*sticky/);
    expect(next).toMatch(/bottom:\s*\d+px/);
  });

  it("keeps the primary control thumb-sized on a phone", () => {
    expect(Number(rule(phone, ".btn-primary").match(/min-height:\s*(\d+)px/)?.[1] ?? 0)).toBeGreaterThanOrEqual(44);
    expect(Number(rule(phone, ".player-pick-btn").match(/min-height:\s*(\d+)px/)?.[1] ?? 0)).toBeGreaterThanOrEqual(44);
  });

  it("is noindex, with no canonical, like the game page", () => {
    const layout = read("app/order/layout.tsx");
    expect(layout).toMatch(/robots:\s*\{\s*index:\s*false/);
    expect(layout).toMatch(/alternates:\s*\{\s*canonical:\s*null\s*\}/);
  });
});

describe("the setup page starts an order game the same way on all three paths", () => {
  const setup = code(read(SETUP));

  it("holds a QR room's consumed pool, so a refused order start can be retried", () => {
    // The pool route consumes the room before it answers; fetching it again
    // is room_already_started, and every friend's playlist is gone.
    const start = setup.match(/async function handleRoomStart\(\) \{([\s\S]*?)\n  \}\n/)?.[1] ?? "";
    expect(start).toMatch(/const held = roomPoolRef\.current;\s*if \(held && held\.code === openedRoom\.code\) \{\s*data = held\.data;/);
    expect(start).toMatch(/roomPoolRef\.current = \{ code: openedRoom\.code, data \};/);
    expect(start.indexOf("roomPoolRef.current = {")).toBeLessThan(start.indexOf("orderRefusal("));
    expect(setup).toMatch(/function resetRoom\(\) \{\s*roomPoolRef\.current = null;/);
  });

  it("keeps the buzzer and its room through a change of style, and hands the order game the handle", () => {
    // With the order game the room is what puts the cards on every phone.
    const choose = setup.match(/function choosePlayStyle\(style: PlayStyle\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";
    expect(choose).not.toMatch(/setBuzzerEnabled|resetRoom/);
    expect(setup).toMatch(/const room = !buzzerEnabled \? undefined : openedRoom\.buzzer;/);
    expect(setup).not.toMatch(/isOrder \|\| !buzzerEnabled/);
  });

  it("filters to dated songs, refuses a list that deals no round, and stores mode \"order\"", () => {
    expect(setup.match(/usableOrderTracks\(/g) ?? []).toHaveLength(3);
    // One refusal rule for the three paths — orderRefusal tells a cache with
    // no dates yet apart from a playlist with too few years.
    expect(setup.match(/= isOrder \? orderRefusal\((?:shuffled|pooled|data\.tracks)\) : null;/g) ?? []).toHaveLength(3);
    expect(setup.match(/if \(refusal\) throw new AppError\(refusal\);/g) ?? []).toHaveLength(3);
    // A list the count cut too short names the count, not the playlist.
    expect(setup).toMatch(/if \(isOrder && orderRefusal\(limited\)\) throw new AppError\("order_count_too_small"\);/);
    expect(setup).not.toMatch(/buildOrderRounds/);
    expect(setup).toMatch(/isOrder \? "order" : hasBuzzerRoom \? "buzzer" : "party"/);
    expect(setup.match(/\bmode: gameMode\(Boolean\(room\)\),/g) ?? []).toHaveLength(3);
    expect(setup.match(/game_mode: gameMode\(Boolean\(room\)\),/g) ?? []).toHaveLength(3);
    expect(setup).toMatch(/const gameHref = isOrder \? "\/order" : "\/game";/);
  });

  it("remembers the play style with every start, and restores it through the form", () => {
    expect(setup.match(/^\s*playStyle,\s*$/gm) ?? []).toHaveLength(3);
    expect(setup).toMatch(/setPlayStyle\(form\.playStyle\);/);
  });

  it("hides the clip length in the order style, and offers the buzzer there as phones", () => {
    expect(setup).toMatch(/\{!isOrder && \(\s*<div>\s*<p className="section-label">Clip Duration<\/p>/);
    expect(setup).toMatch(/\{isBuzzerConfigured\(\) && who !== "solo" && \(\s*<div>\s*<p className="section-label">\{isOrder \? "Play on phones" : "Buzzer Mode"\}<\/p>/);
    expect(setup).not.toMatch(/isBuzzerConfigured\(\) && !isOrder/);
    expect(setup).toMatch(/choosePlayStyle\("order"\)/);
    expect(setup).toMatch(/choosePlayStyle\("guess"\)/);
  });

  it("offers the buzzer under a group's roster, through the fold's own two calls, and no nudge", () => {
    // 1.22.0 left the toggle in the settings fold alone and buzzer games fell
    // 61%. The row sits inside the roster block — single playlist, buzzer off,
    // not "Just me" — so it is never drawn where it has nothing to do.
    const roster = setup.match(/\{setupMode === "single" && !buzzerEnabled && who !== "solo" && \(([\s\S]*?)\n            \)\}/)?.[1] ?? "";
    // The row yields to nothing: the Mixed nudge that owned this slot at three
    // names came off on 2026-11-10 at a 1.2% tap rate, so the buzzer — the
    // best cell in the mode × players table at 2+ — shows under every roster.
    expect(roster).toMatch(/\{isBuzzerConfigured\(\) && \(\s*<button type="button" className="buzzer-nudge" onClick=\{offerBuzzer\}>/);
    expect(setup).not.toMatch(/mixed-nudge|showMixedNudge|reportMixedNudge|mixedNudge|takeMixedNudge/);
    expect(roster).toMatch(/isOrder \? "Play on phones →" : "Turn on Buzzer Mode →"/);
    expect(setup).toMatch(/function offerBuzzer\(\) \{\s*setBuzzerEnabled\(true\);\s*resetRoom\(\);\s*\}/);
    expect(setup.match(/className="buzzer-nudge"/g) ?? []).toHaveLength(1);
    // The solo nudge came off on 2026-11-01: "Just me" does its job.
    expect(setup).not.toMatch(/solo-nudge|showSoloNudge|reportSoloNudge|soloNudge/);
    const css = read("components/setup-chrome.tsx");
    // The base rule used to be shared with the Mixed nudge; deleting the block
    // with it would leave the row unstyled while the hover pin still passed.
    expect(css).toMatch(/\.buzzer-nudge \{[^}]*width: 100%;[^}]*border-radius: 10px;/);
    expect(css).toMatch(/\.buzzer-nudge strong \{ color: var\(--green\)/);
    expect(css).toMatch(/@media \(hover: hover\) \{\s*\.buzzer-nudge:hover/);
    expect(css).toMatch(/\.buzzer-nudge:active \{[^}]*transition: none/);
    expect(css).not.toMatch(/solo-nudge|mixed-nudge/);
  });

  it("says what the song count means in this style, and never a clip length", () => {
    // The summary names the game for a room ("Just me" is the order game
    // already) and gives a clip length only to the guess game.
    expect(setup).toMatch(/who === "solo" \? \[\] : \[isOrder \? "Put them in order" : "Guess the song"\]/);
    expect(setup).toMatch(/isOrder \? \[\] : \[`\$\{clipDuration\}s clips`\]/);
    expect(setup).toMatch(/orderSummary\(songCount\.count\)/);
  });
});

describe("the order page's drag", () => {
  const src = readFileSync(join(process.cwd(), "app/order/page.tsx"), "utf8");

  it("reads the reveal against the room's arrangement, not the deal", () => {
    expect(src).toMatch(/const slotOf = new Map\(arrangedIds\.map/);
    expect(src).toMatch(/readArrangement\(arrangedIds, round\)/);
  });

  it("scores a one-player game from the screen, and leaves a room to the host", () => {
    expect(src).toMatch(/if \(players\.length === 1 && round\) \{[\s\S]*?if \(result\.exact\) awardExact\(players\[0\]\.name\);\s*if \(result\.oldest\) awardOldest\(players\[0\]\.name\);/);
  });

  it("moves by pointer and by arrow key, only while the cards are face down", () => {
    expect(src).toMatch(/onPointerDown:/);
    expect(src).toMatch(/onKeyDown:/);
    // The drag is the one the phones use (lib/use-card-drag.ts), live only
    // while the cards are face down; the hook makes every handler a no-op
    // when it is not.
    expect(src).toMatch(/const cardDrag = useCardDrag\(arrangedIds, phase === "showing", setIds\);/);
    const hook = readFileSync(join(process.cwd(), "lib/use-card-drag.ts"), "utf8");
    expect(hook).toMatch(/function pickUp[\s\S]*?if \(!enabled \|\| !listRef\.current\) return;/);
    expect(hook).toMatch(/function keyMove[\s\S]*?if \(!enabled\) return;/);
    expect(src).toMatch(/\.order-card\.movable \{[^}]*touch-action: none/);
    expect(src).not.toMatch(/function pickUp|function dragMove/);
  });

  it("drags on the phone with the same hook, so there is one implementation", () => {
    const phone = readFileSync(join(process.cwd(), "components/order-phone.tsx"), "utf8");
    expect(phone).toMatch(/useCardDrag\(ids, !revealed,/);
    expect(phone).not.toMatch(/setPointerCapture|dropSlot|moveCard/);
  });

  it("gives a one-player game no buttons to award itself", () => {
    expect(src).toMatch(/const solo = players\.length === 1;/);
    expect(src).toMatch(/\{solo \? \(\s*<p className="awarded-line">/);
    expect(src).toMatch(/solo && oldestWinner === null \? \(/);
  });

  it("reports whether the round was dragged", () => {
    expect(src).toMatch(/hostArranged\(arrangement, currentIndex\)\s*\);/);
  });
});

describe("the order game's first screen (2026-11-10)", () => {
  const globals = read("app/globals.css");
  const phone = read("components/order-phone.tsx");

  it("beckons with the last card, from showDragCue, and only while nothing is lifted", () => {
    // 82% of round-zero bounces moved nothing. The cue is the gesture asked
    // for — the last card lifting toward the top — never the top card, which
    // under "Oldest on top" reads as a hint about the answer. Derived from
    // state, no timer.
    expect(body).toMatch(
      /const beckon = phase === "showing" && showDragCue\(\{ round: currentIndex, moved: hostMoved, phones: Boolean\(buzzerRoom\) \}\);/
    );
    expect(body).toMatch(/const beckoning = beckon && i === cards\.length - 1;/);
    expect(body).toMatch(/\$\{beckoning \? " beckon" : ""\}/);
    expect(body).not.toMatch(/setTimeout\([^)]*beckon|setInterval/);
    // The keyframe lives once, in app/globals.css, under reduced-motion, and
    // never fights the drag's inline transform.
    const motion = globals.match(/@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(motion).toMatch(/\.beckon:not\(\.lifted\) \{ animation: beckon 1\.6s ease 0\.8s 2; \}/);
    expect(motion).toMatch(/@keyframes beckon \{[\s\S]*translateY\(-7px\)/);
    expect(globals.match(/@keyframes beckon/g) ?? []).toHaveLength(1);
    expect(source).not.toMatch(/@keyframes beckon/);
    expect(phone).not.toMatch(/@keyframes/);
    // No other card rule animates; the page wrapper's fade-in is unchanged.
    const cardRules = source.match(/\.order-card[^{]*\{[^}]*animation[^}]*\}/g) ?? [];
    expect(cardRules).toEqual([]);
    expect(source).toMatch(/@keyframes fade-in/);
  });

  it("gives every face-down card the shared grip, hidden from a screen reader, at the trailing edge", () => {
    expect(body).toMatch(/\{!isRevealed && <CardGrip \/>\}/);
    expect(body.indexOf("{!isRevealed && <CardGrip />}")).toBeGreaterThan(body.indexOf('<div className="order-text">'));
    expect(body.indexOf("{!isRevealed && <CardGrip />}")).toBeLessThan(body.indexOf('<span className="order-mark">'));
    expect(phone).toMatch(/\{!revealed && <CardGrip className=\{lifted \? "text-\[#1DB954\]" : "text-\[#666\]"\} \/>\}/);
    const grip = read("components/card-grip.tsx");
    expect(grip).toMatch(/aria-hidden="true"/);
    expect(grip).toMatch(/fill="currentColor"/);
    expect(grip).toMatch(/viewBox="0 0 10 16"/);
    expect(rule(source, ".card-grip")).toMatch(/color: #666/);
    expect(source).toMatch(/\.order-card\.lifted \.card-grip \{ color: #1DB954; \}/);
  });

  it("says the instruction in sentence case at an AA grey, and keeps the green uppercase for the result", () => {
    const prompt = rule(source, ".order-prompt");
    expect(prompt).toMatch(/color: #9a9a9a/);
    expect(prompt).not.toMatch(/uppercase|letter-spacing/);
    expect(source).toMatch(/\.order-prompt\.revealed \{ color: #1DB954; letter-spacing: 0\.06em; text-transform: uppercase; \}/);
    expect(body).toMatch(/"Oldest on top\. Drag the cards into order, then reveal"/);
  });

  it("draws Reveal as a green-bordered ghost on round one until a card moves, never disabled", () => {
    expect(body).toMatch(/const revealUntouched = currentIndex === 0 && !hostMoved && !buzzerRoom;/);
    expect(body).toMatch(
      /<button className=\{revealUntouched \? "btn-ghost btn-ghost-accent" : "btn-primary"\} onClick=\{reveal\}>/
    );
    expect(body).not.toMatch(/onClick=\{reveal\}[^>]*disabled/);
    // The primary's box: border taken out of the padding, so the swap moves nothing.
    const accent = rule(source, ".btn-ghost.btn-ghost-accent");
    expect(accent).toMatch(/border: 1\.5px solid #1DB954/);
    expect(accent).toMatch(/padding: 10\.5px 12px/);
    expect(accent).toMatch(/font-size: 15px/);
    expect(rule(source, ".btn-primary")).toMatch(/padding: 12px;/);
    const phoneCss = phoneBlock(source);
    expect(rule(phoneCss, ".btn-ghost.btn-ghost-accent")).toMatch(/min-height: 48px/);
    expect(rule(phoneCss, ".btn-primary")).toMatch(/min-height: 48px/);
    expect(source).toMatch(/\.btn-ghost\.btn-ghost-accent:active \{[^}]*transition: none/);
  });

  it("tells an untouched host what they did not do — only when nothing scored and no phones played", () => {
    // A deal left alone is still graded, and the top card is the oldest one
    // time in four: the line must never contradict a scoreboard that moved.
    expect(body).toMatch(
      /\{!hostMoved && !buzzerRoom && exactWinner === null && oldestWinner === null && \(\s*<p className="order-untouched">Left as dealt — drag the cards next round to score\.<\/p>/
    );
    expect(body.indexOf('className="order-untouched"')).toBeGreaterThan(body.indexOf('className={`order-result'));
    expect(rule(source, ".order-untouched")).toMatch(/color: #888/);
    expect(body).not.toMatch(/order_untouched|reportOrderUntouched/); // no new key: order_bounce is the read
  });
});
