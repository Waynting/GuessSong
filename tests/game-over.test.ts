import { describe, it, expect, afterEach, vi } from "vitest";
import {
  MIXED_NEXT_GAME_LABEL,
  MIXED_SETUP_HREF,
  PHONE_MAX_WIDTH_PX,
  PHONE_MEDIA_QUERY,
  gameOverOnward,
  gameScreenFor,
  readGameScreen,
} from "@/lib/game-over";
import { GAME_SCREENS } from "@/lib/loop-stats";

/**
 * What the Game Over screen offers next. On a phone the QR read 3 followed of
 * 994 shown, because the screen showing the code is the one device in the
 * room that cannot scan it.
 */
describe("the phone gets a link, the desktop keeps the QR", () => {
  it("offers the QR on a desktop, exactly as before", () => {
    expect(gameOverOnward("desktop")).toBe("qr");
  });

  it("offers the Mixed link on a phone, and not the QR", () => {
    expect(gameOverOnward("phone")).toBe("mixed_link");
  });

  it("offers nothing until the layout is known", () => {
    // Either default is wrong for somebody, and the wrong one on a phone is
    // an impression reported for a code that was on screen for one frame.
    expect(gameOverOnward(null)).toBe("nothing");
  });

  it("answers for every screen the server keys", () => {
    for (const screen of GAME_SCREENS) expect(gameOverOnward(screen)).not.toBe("nothing");
  });
});

describe("which layout this is", () => {
  it("reads the media query's answer", () => {
    expect(gameScreenFor(true)).toBe("phone");
    expect(gameScreenFor(false)).toBe("desktop");
  });

  it("does not guess before there is an answer", () => {
    expect(gameScreenFor(null)).toBeNull();
    expect(gameScreenFor(undefined)).toBeNull();
  });

  it("asks at the phone layout's own breakpoint", () => {
    expect(PHONE_MAX_WIDTH_PX).toBe(768);
    expect(PHONE_MEDIA_QUERY).toBe("(max-width: 768px)");
  });
});

describe("reading the layout from a click", () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
    vi.restoreAllMocks();
  });

  it("asks the phone query and reports what it says", () => {
    const asked: string[] = [];
    window.matchMedia = ((query: string) => {
      asked.push(query);
      return { matches: true } as MediaQueryList;
    }) as typeof window.matchMedia;
    expect(readGameScreen()).toBe("phone");
    expect(asked).toEqual([PHONE_MEDIA_QUERY]);

    window.matchMedia = (() => ({ matches: false }) as MediaQueryList) as typeof window.matchMedia;
    expect(readGameScreen()).toBe("desktop");
  });

  it("sends no screen rather than a guessed one when there is nothing to ask", () => {
    // @ts-expect-error — a webview old enough to have no matchMedia at all.
    window.matchMedia = undefined;
    expect(readGameScreen()).toBeNull();
  });

  it("never throws into the click that ends the game", () => {
    window.matchMedia = (() => {
      throw new Error("not in this webview");
    }) as typeof window.matchMedia;
    expect(() => readGameScreen()).not.toThrow();
    expect(readGameScreen()).toBeNull();
  });
});

describe("where the link goes and what it says", () => {
  it("opens setup on Mixed Playlist Mode", () => {
    expect(MIXED_SETUP_HREF).toBe("/?mode=mixed");
  });

  it("is a relative link, so it works on a preview deploy", () => {
    expect(MIXED_SETUP_HREF.startsWith("/")).toBe(true);
    expect(MIXED_SETUP_HREF).not.toMatch(/^\/\/|https?:/);
  });

  it("does not go through the counting redirect", () => {
    // `/r/<surface>` counts a loop click and is for links that leave a page
    // of ours behind. This one is a host going from one of our pages to
    // another, counted by its own beacon.
    expect(MIXED_SETUP_HREF).not.toMatch(/^\/r\//);
  });

  it("says what the mode is, not what it is called", () => {
    expect(MIXED_NEXT_GAME_LABEL).toMatch(/own playlist/i);
    expect(MIXED_NEXT_GAME_LABEL.trim().endsWith("→")).toBe(true);
  });
});
