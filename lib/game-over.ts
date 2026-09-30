/**
 * What the Game Over screen offers the host to do next, by layout.
 *
 * ## Why the phone does not get the QR
 *
 * `components/loop-qr.tsx` was written for a television: the room looking at
 * the host's screen from across it, phones in hand. That is the desktop case
 * and it stays exactly as it was. But most games are hosted from a phone, and
 * there the screen showing the code *is* the phone — it is in the host's hand,
 * a foot from their face, and the one device in the room that cannot scan it.
 * In the week to 2026-09-29 the surface read 994 shown, 3 followed.
 *
 * So a phone gets a link instead, to Mixed Playlist Mode: "everyone brings
 * their own playlist" is a reason to play again that "Play Again" is not, and
 * a link is something the person holding the screen can actually follow.
 *
 * **On a phone the QR is not rendered at all, rather than hidden.** Its
 * impression is reported from an effect inside the component
 * (`reportLoopImpression("game_over")`), so a `display: none` would keep
 * counting a surface nobody was shown and drag the `game_over` rate towards
 * zero for a reason that has nothing to do with the code.
 *
 * In `lib/` for the usual reason: the suite cannot import the page.
 */

import type { GameScreen } from "@/lib/loop-stats";

/**
 * The phone layout's own breakpoint — the `@media (max-width: 768px)` block
 * in `app/game/page.tsx`. One number in two languages, CSS and this, and
 * `tests/game-page.test.ts` is what holds them together: if they drift, a
 * tablet in the gap gets the phone's stylesheet with the desktop's QR.
 */
export const PHONE_MAX_WIDTH_PX = 768;

export const PHONE_MEDIA_QUERY = `(max-width: ${PHONE_MAX_WIDTH_PX}px)`;

/**
 * Setup, opened on Mixed Playlist Mode — `requestedSetupMode` in
 * `lib/setup-arrival.ts` is what makes `/` honour it.
 */
// Declared once, with the rule that reads it (`requestedSetupMode`); a
// second spelling here is a link `/` could stop honouring without a test noticing.
export { MIXED_SETUP_HREF } from "@/lib/setup-arrival";

export const MIXED_NEXT_GAME_LABEL = "Next game: everyone brings their own playlist →";

/**
 * Which layout this is, or null before the page can know.
 *
 * `matches` is read in an effect, never during render: the server has no
 * viewport, so a value read while rendering would be `desktop` there and
 * could be `phone` on the client's first pass — a hydration mismatch on the
 * one page a host cannot afford to have remount.
 */
export function gameScreenFor(matchesPhoneQuery: boolean | null | undefined): GameScreen | null {
  if (matchesPhoneQuery === null || matchesPhoneQuery === undefined) return null;
  return matchesPhoneQuery ? "phone" : "desktop";
}

/**
 *   qr          the loop's QR code, for a room looking at a shared screen
 *   mixed_link  the link to Mixed Playlist Mode, for a host holding the screen
 *   nothing     the layout is not known yet
 *
 * `nothing` while unknown, rather than a default: either default is wrong for
 * somebody, and the wrong one on a phone is an impression reported for a code
 * that was on screen for one frame.
 */
export type GameOverOnward = "qr" | "mixed_link" | "nothing";

export function gameOverOnward(screen: GameScreen | null): GameOverOnward {
  if (screen === null) return "nothing";
  return screen === "phone" ? "mixed_link" : "qr";
}

/**
 * Reads the layout now, for a handler that cannot wait for an effect — the
 * end beacon is sent from the click that ends the game. Null when there is no
 * `matchMedia` to ask (a very old webview), and the caller sends no screen
 * rather than a guessed one.
 */
export function readGameScreen(): GameScreen | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  try {
    return gameScreenFor(window.matchMedia(PHONE_MEDIA_QUERY).matches);
  } catch {
    return null;
  }
}
