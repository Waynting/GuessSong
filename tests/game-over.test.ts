import { describe, it, expect, afterEach, vi } from "vitest";
import {
  MIXED_NEXT_GAME_LABEL,
  MIXED_SETUP_HREF,
  PHONE_MAX_WIDTH_PX,
  PHONE_MEDIA_QUERY,
  MIXED_LINK_MIN_PLAYERS,
  gameOverOnward,
  gameScreenFor,
  readGameScreen,
} from "@/lib/game-over";
import { GAME_SCREENS } from "@/lib/loop-stats";

/**
 * What the Game Over screen offers next. On a phone the QR read 3 followed of
 * 994 shown, because the screen showing the code is the one device in the
 * room that cannot scan it. On a desktop the QR stays, and a room of two or
 * more gets the Mixed link under it — the one arm of the loop that converts.
 */
describe("the phone gets a link, the desktop keeps the QR and a room gets the link too", () => {
  it("offers the QR on a desktop, exactly as before, and no link to a host alone", () => {
    expect(gameOverOnward("desktop", 1)).toEqual({ qr: true, mixedLink: false });
    expect(gameOverOnward("desktop", 0)).toEqual({ qr: true, mixedLink: false });
  });

  it("adds the Mixed link under the desktop's QR for a room of two or more", () => {
    expect(MIXED_LINK_MIN_PLAYERS).toBe(2);
    for (const players of [2, 3, 4, 12]) {
      expect(gameOverOnward("desktop", players)).toEqual({ qr: true, mixedLink: true });
    }
  });

  it("offers the Mixed link on a phone, never the QR, whatever the room", () => {
    for (const players of [0, 1, 2, 5]) {
      expect(gameOverOnward("phone", players)).toEqual({ qr: false, mixedLink: true });
    }
  });

  it("offers nothing until the layout is known", () => {
    // Either default is wrong for somebody, and the wrong one on a phone is
    // an impression reported for a code that was on screen for one frame.
    expect(gameOverOnward(null, 3)).toEqual({ qr: false, mixedLink: false });
  });

  it("answers for every screen the server keys", () => {
    for (const screen of GAME_SCREENS) {
      const onward = gameOverOnward(screen, 2);
      expect(onward.qr || onward.mixedLink).toBe(true);
    }
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
