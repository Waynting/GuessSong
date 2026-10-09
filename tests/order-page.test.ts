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
    expect(body).toMatch(/const cards = isRevealed && round \? trueOrder\(round\) : dealt;/);
    expect(body.match(/buildOrderRounds\(/g) ?? []).toHaveLength(1);
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
  });

  it("reports a round's verdict once, from the one place a revealed round closes", () => {
    expect(body.match(/reportOrderRound\(/g) ?? []).toHaveLength(1);
    const close = member("closeRound");
    expect(close).toMatch(/if \(phase !== "revealed"\) return;/);
    expect(close).toMatch(
      /reportOrderRound\(\s*orderVerdict\(\{ exact: exactWinner !== null, oldest: oldestWinner !== null \}\),/
    );
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
    expect(leave).toMatch(/"order"\s*\);/);
    expect(body.match(/reportGameLeft\(/g) ?? []).toHaveLength(1);
  });

  it("never calls recordHostedStart or the first-clip reporter — a start is the setup page's, a clip is not here", () => {
    expect(body).not.toMatch(/recordHostedStart|reportGameStart|reportFirstClip|bumpHostGameCount/);
  });
});

describe("the order page's Game Over", () => {
  it("renders the QR only where the rule says to, so a phone never reports its impression", () => {
    expect(body.match(/<LoopQr\b/g) ?? []).toHaveLength(1);
    expect(body).toMatch(/\{onward === "qr" && <LoopQr \/>\}/);
    expect(body).toMatch(/const onward = gameOverOnward\(screen\);/);
    expect(body).not.toMatch(/reportLoopImpression/);
  });

  it("gives the phone the Mixed link from the constants in lib/, and counts both taps before navigating", () => {
    expect(body).toMatch(
      /\{onward === "mixed_link" && \(\s*<a className="next-game-link" href=\{MIXED_SETUP_HREF\} onClick=\{openMixedSetup\}>\s*\{MIXED_NEXT_GAME_LABEL\}/
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

  it("filters to dated songs, refuses a list that deals no round, and stores mode \"order\"", () => {
    expect(setup.match(/usableOrderTracks\(/g) ?? []).toHaveLength(3);
    expect(setup.match(/buildOrderRounds\([a-z]+\)\.rounds\.length === 0/g) ?? []).toHaveLength(3);
    expect(setup.match(/new AppError\("order_too_few_dated"\)/g) ?? []).toHaveLength(3);
    expect(setup).toMatch(/isOrder \? "order" : hasBuzzerRoom \? "buzzer" : "party"/);
    expect(setup.match(/\bmode: gameMode\(Boolean\(room\)\),/g) ?? []).toHaveLength(3);
    expect(setup.match(/game_mode: gameMode\(Boolean\(room\)\),/g) ?? []).toHaveLength(3);
    expect(setup).toMatch(/const gameHref = isOrder \? "\/order" : "\/game";/);
  });

  it("remembers the play style with every start, and restores it through the form", () => {
    expect(setup.match(/^\s*playStyle,\s*$/gm) ?? []).toHaveLength(3);
    expect(setup).toMatch(/setPlayStyle\(form\.playStyle\);/);
  });

  it("hides the clip length and the buzzer in the order style, and turns the buzzer off on the way in", () => {
    expect(setup).toMatch(/\{!isOrder && \(\s*<div>\s*<p className="section-label">Clip Duration<\/p>/);
    expect(setup).toMatch(/\{isBuzzerConfigured\(\) && !isOrder && \(/);
    const choose = setup.match(/function choosePlayStyle\(style: PlayStyle\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";
    expect(choose).toMatch(/if \(style === "order" && buzzerEnabled\) \{\s*setBuzzerEnabled\(false\);\s*resetRoom\(\);/);
    expect(setup).toMatch(/choosePlayStyle\("order"\)/);
    expect(setup).toMatch(/choosePlayStyle\("guess"\)/);
  });

  it("says what the song count means in this style, and never a clip length", () => {
    expect(setup).toMatch(/isOrder \? "Order by year" : `\$\{clipDuration\}s clips`/);
    expect(setup).toMatch(/orderSummary\(songCount\.count\)/);
  });
});
