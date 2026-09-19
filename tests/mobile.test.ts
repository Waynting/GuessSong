// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The phone rules, as far as the suite can see them.
 *
 * Most hosts run the game from a phone, and every rule here was found by
 * measuring a 390×844 viewport after it had shipped without one. They fail
 * the same way: the page renders, the build passes, the desktop looks fine,
 * and a phone is quietly worse — a field that zooms the page in, a grid
 * column that runs past the edge under `overflow: hidden`, a safe-area
 * padding that computes to 0px. The pages are client components vitest
 * cannot import, so this reads the source the way tests/setup-pages.test.ts
 * does.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** The source with its comments removed, so a rule named in prose does not pass for one in code. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** The body of one CSS rule from a <style> template: the text between `selector {` and its `}`. */
function rule(css: string, selector: string): string {
  const re = new RegExp(`^\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m");
  const m = css.match(re);
  expect(m, `no rule for ${selector}`).not.toBeNull();
  return m![1];
}

/** The `{` at or after `at` and its matching `}`, as indexes into `css`. */
function blockAt(css: string, at: number): [open: number, close: number] {
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let j = open; j < css.length; j++) {
    if (css[j] === "{") depth++;
    else if (css[j] === "}" && --depth === 0) return [open, j];
  }
  throw new Error("unbalanced braces");
}

/** The stylesheet with every `@media (hover: hover) { ... }` block cut out, braces matched. */
function outsideHoverMedia(css: string): string {
  const open = "@media (hover: hover)";
  let out = "";
  let i = 0;
  for (;;) {
    const at = css.indexOf(open, i);
    if (at === -1) return out + css.slice(i);
    out += css.slice(i, at);
    const [, close] = blockAt(css, at);
    i = close + 1;
  }
}

/** The `@media (max-width: 768px) { ... }` block of a stylesheet, braces matched, or a failed assertion. */
function phoneBlock(css: string): string {
  const at = css.indexOf("@media (max-width: 768px)");
  expect(at, "no phone block").toBeGreaterThan(-1);
  const [open, close] = blockAt(css, at);
  return css.slice(open + 1, close);
}

const LAYOUT = "app/layout.tsx";
const GAME = "app/game/page.tsx";
const CHROME = "components/setup-chrome.tsx";

describe("the viewport reaches the edges of the phone", () => {
  const layout = code(read(LAYOUT));

  it("declares viewport-fit=cover, or every safe-area inset on the site is zero", () => {
    // env(safe-area-inset-*) evaluates to 0 unless the viewport opts into
    // the notch and the home indicator. The quiz shell padded by them for a
    // release before anything noticed, because the padding it added was
    // nothing.
    expect(layout).toMatch(/viewportFit:\s*"cover"/);
  });

  it("agrees with manifest.json about the theme colour", () => {
    // Android paints the address bar with the meta tag and the installed
    // app's title bar with the manifest; two values is a site that changes
    // colour when it is installed.
    const manifest = JSON.parse(read("public/manifest.json")) as { theme_color: string };
    const meta = layout.match(/themeColor:\s*"(#[0-9a-fA-F]{6})"/);
    expect(meta).not.toBeNull();
    expect(meta![1].toLowerCase()).toBe(manifest.theme_color.toLowerCase());
  });

  it("pads the landscape notch once, on body, outside @layer", () => {
    // cover lets every page run under the notch. Handled on body so the
    // desktop grid a landscape phone gets is covered too, and unlayered
    // because the game page's own `* { padding: 0 }` is unlayered and an
    // unlayered rule beats any layered one. The quiz shell used to add the
    // side insets itself, which doubled them once body did.
    const globals = read("app/globals.css");
    const bodyRule = globals.match(/^body\s*\{([^}]*)\}/m);
    expect(bodyRule, "no unlayered body rule").not.toBeNull();
    expect(bodyRule![1]).toMatch(/padding-left:\s*env\(safe-area-inset-left\)/);
    expect(bodyRule![1]).toMatch(/padding-right:\s*env\(safe-area-inset-right\)/);
    const shell = read("app/q/[code]/shell.tsx");
    expect(shell).not.toMatch(/safe-area-inset-(left|right)/);
  });

  it("sets the iOS home-screen title and status bar", () => {
    // manifest.json's display: standalone is what makes it an app on iOS;
    // the title and the status bar are the two things iOS still takes only
    // from meta. Opaque black so no page has to pad for it; a translucent
    // bar would put the setup page's language switch under the clock.
    expect(layout).toMatch(/appleWebApp:\s*\{[^}]*title:\s*"GuessSong"/);
    expect(layout).toMatch(/appleWebApp:\s*\{[^}]*statusBarStyle:\s*"black"/);
    expect(layout).toMatch(/"apple-mobile-web-app-capable":\s*"yes"/);
  });
});

describe("no focusable field is smaller than 16px", () => {
  // iOS Safari zooms the page into a focused input with a smaller computed
  // font-size and does not zoom back out. Every field on /, /quiz and the
  // room panels draws one of these three classes; the join and quiz pages
  // draw the shadcn Input; and the game's clipboard fallback is a textarea.
  const chrome = read(CHROME);

  const px = (css: string, selector: string) => {
    const size = rule(css, selector).match(/font-size:\s*(\d+(?:\.\d+)?)px/);
    expect(size, `${selector} sets no font-size`).not.toBeNull();
    return Number(size![1]);
  };

  it.each([".url-input", ".player-input", ".count-input"])("%s is at least 16px", (cls) => {
    expect(px(chrome, cls)).toBeGreaterThanOrEqual(16);
  });

  it(".count-input's 16px outranks .pill's 14px in the cascade", () => {
    // The field is `pill count-input`, both single-class selectors, so the
    // later rule wins and the order is the rule: swap them and the field
    // renders at 14px with this file's other assertion still green. The
    // pill rule is asserted to exist first, or a reformatted selector would
    // pass this vacuously through indexOf's -1.
    const pill = chrome.indexOf(".pill {");
    expect(pill, "no .pill rule").toBeGreaterThan(-1);
    expect(rule(chrome, ".pill")).toMatch(/font-size:\s*14px/);
    expect(chrome.indexOf(".count-input {")).toBeGreaterThan(pill);
  });

  it("the game's clipboard-fallback textarea sits on the floor too", () => {
    // It selects itself on focus, so it is focused by design.
    expect(px(read(GAME), ".mix-fallback")).toBeGreaterThanOrEqual(16);
  });

  it("the shadcn Input the join and quiz pages draw is text-base below md", () => {
    const input = read("components/ui/input.tsx");
    expect(input).toMatch(/\btext-base\b/);
    expect(input).not.toMatch(/(^|[^:\w-])text-(xs|sm)\b/);
  });
});

describe("the game fits the phone it is played on", () => {
  const game = read(GAME);
  const body = code(game);

  it("lets the main column shrink below the top bar's contents", () => {
    // A bare `1fr` is minmax(auto, 1fr), and `auto` lets the column grow to
    // the top bar's one-line contents. On a 390px phone that was 435px:
    // End Game half a button, the scoreboard's numbers off screen, and
    // `overflow: hidden` on body meaning nothing could be scrolled into
    // view. Both the two-column and the stacked layout must say minmax(0,
    // 1fr) for the game column.
    const columns = [...game.matchAll(/grid-template-columns:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(columns.length).toBeGreaterThanOrEqual(2);
    for (const value of columns) {
      expect(value, value).not.toMatch(/(^|\s)1fr(\s|$)/);
      expect(value, value).toMatch(/minmax\(0,\s*1fr\)/);
    }
    expect(rule(game, ".top-bar")).toMatch(/min-width:\s*0/);
    expect(rule(game, ".playlist-name")).toMatch(/min-width:\s*0/);
  });

  it("refuses pull-to-refresh, because a refresh is round one with the scores wiped", () => {
    // The payload in sessionStorage is the setup, not the progress: a
    // reload restarts the game. Android's pull-to-refresh is a drag past the
    // top of the card, which is the ordinary way to scroll back up.
    expect(game).toMatch(/html,\s*body\s*\{[^}]*overscroll-behavior-y:\s*none/);
    expect(rule(game, ".main-area")).toMatch(/overscroll-behavior:\s*contain/);
  });

  it("keeps the screen awake for the whole game", () => {
    // A phone left alone through a long guess locks, and a locked iPhone
    // pauses the clip. Held through the final scores too — that is the
    // screen the room scans the QR code off.
    // The argument is pinned: `phase !== "finished"` would drop the lock on
    // the very screen the room scans.
    expect(body).toMatch(/useScreenWakeLock\(tracks\.length > 0\)/);
    const hook = code(read("lib/wake-lock.ts"));
    expect(hook).toContain('navigator.wakeLock.request("screen")');
    // The browser drops the lock whenever the tab is hidden and never hands
    // it back; without this listener the first notification the host reads
    // ends the lock for the rest of the evening.
    expect(hook).toContain('addEventListener("visibilitychange"');
  });

  it("does not let a long press on the blurred art preview the answer", () => {
    // The blur is CSS. iOS's image callout previews the file as stored.
    const img = rule(game, ".album-img");
    expect(img).toMatch(/-webkit-touch-callout:\s*none/);
    expect(img).toMatch(/pointer-events:\s*none/);
    const tag = body.match(/<img\b[^>]*className=\{`album-img[^>]*>/);
    expect(tag, "no album <img>").not.toBeNull();
    expect(tag![0]).toMatch(/draggable=\{false\}/);
  });

  it("collapses the art at the reveal on a phone, and the markup carries the class", () => {
    // The phone layout sizes the art by the viewport's height and shrinks
    // it when the answer is up so Next Track lands on screen. The CSS reads
    // `.album-wrap.revealed`; a refactor that renames or drops the class on
    // the element leaves full-size art and the button below the fold again.
    expect(game).toMatch(/\.album-wrap\.revealed\s*\{/);
    expect(body).toMatch(/className=\{`album-wrap\$\{isRevealed \? " revealed" : ""\}`\}/);
  });

  it("pads the bottom of the scoreboard, the final screen and the footer for the home indicator", () => {
    expect(game).toMatch(/\.sidebar\s*\{[^}]*padding-bottom:\s*env\(safe-area-inset-bottom\)/);
    expect(rule(game, ".finished-overlay")).toMatch(/env\(safe-area-inset-bottom\)/);
    // The footer is the last thing on every page that has one.
    expect(rule(read("components/site-footer.tsx"), ".site-footer")).toMatch(
      /padding-bottom:\s*env\(safe-area-inset-bottom\)/
    );
  });

  it("the changelog's close button paints its own press", () => {
    // Rendered under the setup sheet, which strips the tap highlight from
    // every button; it has no :hover, so the TOUCH_SHEETS scan never
    // reaches it, and a dropped className leaves a 40px button that gives
    // a finger nothing.
    const dialog = read("components/changelog-dialog.tsx");
    expect(dialog).toMatch(/className="cl-close"/);
    expect(rule(dialog, ".cl-close:active")).toMatch(/background/);
  });
});

/** The two sheets that strip the tap highlight, and the components rendered under them. */
const TOUCH_SHEETS = [
  GAME,
  CHROME,
  "components/site-footer.tsx",
  "components/service-notice.tsx",
  "components/install-banner.tsx",
];

describe("hover is a mouse thing", () => {
  // A tap on a touch screen applies :hover and leaves it applied until the
  // next tap lands somewhere else, so a lifted, brightened button stays
  // lifted. Every :hover rule on these sheets is behind (hover: hover); the
  // pressed state a finger sees is :active.
  it.each(TOUCH_SHEETS)("%s guards every :hover rule", (file) => {
    const css = read(file);
    expect(css).toMatch(/@media \(hover: hover\)/);
    const unguarded = [...outsideHoverMedia(css).matchAll(/^\s*([^{\n]*:hover[^{\n]*)\{/gm)]
      .map((m) => m[1].trim());
    expect(unguarded, `unguarded: ${unguarded.join(", ")}`).toEqual([]);
  });

  it.each(TOUCH_SHEETS)("%s gives every hovered control a pressed state", (file) => {
    // The tap highlight is stripped from every button and link on the
    // premise that each paints its own press. A control with a :hover and
    // no :active is one that gives a finger nothing at all.
    const css = read(file);
    const hovered = new Set(
      [...css.matchAll(/(\.[a-z-]+(?:[ .][a-z-]+)*):hover/g)].map((m) => m[1])
    );
    // `:not(...)` between the selector and :active is allowed: the count
    // field is a pill that must not shrink under the finger.
    const missing = [...hovered].filter(
      (sel) => !new RegExp(`${sel.replace(/[.]/g, "\\.")}(?::not\\([^)]*\\))?:active`).test(css)
    );
    expect(missing, `hover without :active: ${missing.join(", ")}`).toEqual([]);
  });

  it.each(TOUCH_SHEETS)("%s lands every pressed state on touchstart", (file) => {
    // A base rule that eases transform or background eases the press in
    // too, and an 80ms tap lets go before a 150ms ease arrives — the press
    // reads as a flicker. `transition: none` on the :active rule makes the
    // press instant and leaves the ease to the release.
    const css = read(file);
    const eased = [...css.matchAll(/^\s*([^{\n]*:active[^{\n]*)\{([^}]*)\}/gm)]
      .filter((m) => !/transition:\s*none/.test(m[2]))
      .map((m) => m[1].trim());
    expect(eased, `:active without transition: none: ${eased.join(", ")}`).toEqual([]);
  });

  it.each([GAME, CHROME])("%s switches off the tap highlight and double-tap zoom on buttons", (file) => {
    const css = read(file);
    expect(css).toMatch(/-webkit-tap-highlight-color:\s*transparent/);
    expect(css).toMatch(/button\s*\{[^}]*touch-action:\s*manipulation/);
  });
});

describe("the phone layout gives the round back its controls", () => {
  const game = read(GAME);
  const phone = phoneBlock(game);

  it("turns the scoreboard into one sideways row, with no height cap", () => {
    // The 140px list under the card showed two of four players and cost the
    // reveal its last button. One row of chips is the fix, and it only holds
    // if the list scrolls sideways and the sidebar stops capping its height:
    // a refactor that brings `max-height: 140px` back hides the third
    // player again with the desktop looking fine.
    expect(rule(phone, ".sidebar")).toMatch(/max-height:\s*none/);
    expect(rule(phone, ".sidebar")).not.toMatch(/max-height:\s*\d/);
    const list = rule(phone, ".score-list");
    expect(list).toMatch(/display:\s*flex/);
    expect(list).toMatch(/overflow-x:\s*auto/);
    expect(rule(phone, ".score-row")).toMatch(/flex:\s*0 0 auto/);
    // The "Scoreboard" heading is a panel's; a strip has no room for it.
    expect(rule(phone, ".sidebar-header")).toMatch(/display:\s*none/);
  });

  it("gives a short phone less art at the reveal than a tall one, never more", () => {
    // An iPhone SE has ~560px for the card at the reveal and the controls
    // alone need 435 of it. Both sizes are viewport-height shares; the
    // short-phone share must be the smaller one or the nested query does
    // the opposite of what it is for.
    const share = (block: string) => {
      // The dvh line; a vh fallback line precedes it for browsers without dvh.
      const m = block.match(/\.album-wrap\.revealed\s*\{[^}]*clamp\(\d+px,\s*(\d+)dvh/);
      expect(m, "no revealed width share").not.toBeNull();
      return Number(m![1]);
    };
    const tall = share(phone);
    const shortStart = phone.indexOf("@media (max-height: 700px)");
    expect(shortStart, "no short-phone query").toBeGreaterThan(-1);
    const short = share(phone.slice(shortStart));
    expect(short).toBeLessThan(tall);
  });

  it("writes every art width twice, vh first, for browsers without dvh", () => {
    // A browser without dvh drops the whole declaration; without the vh
    // line first the art stays at the base width: 100% in every phase —
    // the old layout back, silently, on iOS before 15.4.
    const bodies = [...phone.matchAll(/\.album-wrap(?:\.revealed)?\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(bodies.length).toBeGreaterThanOrEqual(3);
    for (const body of bodies) {
      const widths = [...body.matchAll(/width:\s*min\(100%,\s*clamp\(\d+px,\s*(\d+)(d?vh)/g)].map((m) => [m[1], m[2]]);
      expect(widths.map(([, unit]) => unit), body).toEqual(["vh", "dvh"]);
      expect(widths[0][0], body).toBe(widths[1][0]);
    }
  });

  it("cuts to the collapsed art rather than animating it", () => {
    // Animating the width reflows the whole card for every frame, on top of
    // the un-blur already running, and a phone GPU drops frames on both.
    // The first cut of this layout had a 0.5s width transition; a refactor
    // that finds the cut abrupt and eases it brings the stutter back.
    // Every .album-wrap rule in the sheet: the base one cascades into the
    // phone layout, and a transition added there animates the collapse
    // with the desktop unaffected.
    const bodies = [...game.matchAll(/^\s*\.album-wrap(?:\.revealed)?\s*\{([^}]*)\}/gm)];
    expect(bodies.length).toBeGreaterThanOrEqual(4);
    for (const m of bodies) expect(m[1], m[0]).not.toMatch(/transition/);
  });
});
