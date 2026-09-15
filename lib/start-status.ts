/**
 * Whether the Start button is live, and the one line under it.
 *
 * The setup page has a single Start button for every way of running a party,
 * and what it is waiting for depends on which way that is: a pass-the-phone
 * mix needs a second playlist, a QR room needs opening and then filling, the
 * buzzer needs the room open but no particular number of phones. Which of
 * those the host is told — and which one when several hold at once — is the
 * rule this module is.
 *
 * It lives here rather than in `app/page.tsx` for the reason `lib/song-count.ts`
 * and `lib/room-poll.ts` give: the test suite only reaches `lib/`, and vitest
 * cannot import a `.tsx` module here. Inside the button's render this was a
 * ladder of five branches with no test, and the strings on it are what a host
 * reads when the button will not press — a branch that quietly stopped being
 * reachable would look like a button that stopped working. The handler the
 * button calls and the label it shows stay in the component: those are wiring
 * and JSX, not rules.
 */

import type { MixedSubMode } from "@/lib/loop-stats";

/**
 * The two ways to run a party from the setup page. The Taste Quiz used to be
 * a third member — it starts from the same pasted playlist — but it is not a
 * game, and a pill for it put "not a party" beside the two things that are.
 * It has its own page now (`app/quiz/`), which is also what keeps it away from
 * `recordHostedStart`: a quiz is one person making something, not a room
 * being hosted.
 */
export type SetupMode = "single" | "mixed";

/**
 * The fewest playlists a mix can be made from. Declared once, here, because
 * two things read it and must agree: the ladder below, which holds the button
 * until the roster reaches it, and `handleMixedStart` in `app/page.tsx`, which
 * refuses with `mixed_min_contributors` if a start gets through anyway.
 */
export const MIXED_MIN_CONTRIBUTORS = 2;

export interface StartInputs {
  setupMode: SetupMode;
  mixedSubMode: MixedSubMode;
  /** A start already in flight — `loading || roomStarting` on the page. */
  busy: boolean;
  /**
   * Whether the modes picked need the one room open before Start. Passed in
   * rather than derived: the page's `needsRoom` is also what decides whether
   * the room panel renders, and "Open the room first" has to point at a panel
   * that is on screen. Two definitions of the same question would let the
   * line and the panel disagree.
   */
  needsRoom: boolean;
  /** `openedRoom !== null` — the room exists, whatever it holds so far. */
  roomOpen: boolean;
  buzzerEnabled: boolean;
  /** Phones that have scanned into the buzzer room. */
  buzzerPlayerCount: number;
  /** Pass-the-phone roster: playlists added on this device. */
  mixedContributions: number;
  /** QR room roster: playlists submitted from other phones. */
  roomSubmissions: number;
}

export interface StartState {
  disabled: boolean;
  /** The line under the button, or null when there is nothing to wait for. */
  status: string | null;
}

/**
 * The button says what it does; what it is waiting for goes on the line under
 * it. It used to carry eight labels, and a button that reads "Waiting for 2
 * more playlists" is a status line the host cannot tap, dressed as the thing
 * they came to tap.
 *
 * The order of the ladder is the order a host can act on it. A short
 * pass-the-phone roster is fixed on this screen without a room, so it comes
 * before the room; an unopened room has to be opened before anything can
 * arrive in it, so it comes before a short QR roster; and the buzzer's line is
 * information rather than a wait, so it is last and never disables anything.
 */
export function startState({
  setupMode,
  mixedSubMode,
  busy,
  needsRoom,
  roomOpen,
  buzzerEnabled,
  buzzerPlayerCount,
  mixedContributions,
  roomSubmissions,
}: StartInputs): StartState {
  const isMixedPhone = setupMode === "mixed" && mixedSubMode === "phone";
  const isMixedRoom = setupMode === "mixed" && mixedSubMode === "room";
  const phoneShort = MIXED_MIN_CONTRIBUTORS - mixedContributions;
  const roomShort = MIXED_MIN_CONTRIBUTORS - roomSubmissions;
  // Every flow that needs phones needs its one room open first.
  // Not a minimum player count for the buzzer though: latecomers
  // can scan in mid-game, and blocking on an arbitrary number
  // would strand a host whose friends are still finding the QR.
  // Mixed·QR is the exception — its pool is built from what the
  // mailbox has when Start is tapped, so it does need people.
  const roomNotReady = needsRoom && !roomOpen;
  const disabled =
    busy ||
    roomNotReady ||
    (isMixedPhone && mixedContributions < MIXED_MIN_CONTRIBUTORS) ||
    (isMixedRoom && roomSubmissions < MIXED_MIN_CONTRIBUTORS);

  let status: string | null = null;
  if (busy) {
    // The spinner on the button says enough.
  } else if (isMixedPhone && phoneShort > 0) {
    status = `Add ${phoneShort} more player${phoneShort === 1 ? "" : "s"} to start`;
  } else if (roomNotReady) {
    status = "Open the room first";
  } else if (isMixedRoom && roomShort > 0) {
    // Playlists, not players. The host is a player too but scans
    // nothing, so counting people here read as "wait for another
    // guest" when what was actually missing was the host's own
    // playlist — which they add from the room card.
    status = `Waiting for ${roomShort} more playlist${roomShort === 1 ? "" : "s"}`;
  } else if (buzzerEnabled) {
    status =
      buzzerPlayerCount > 0
        ? `${buzzerPlayerCount} phone${buzzerPlayerCount === 1 ? "" : "s"} ready`
        : "Nobody has scanned yet — you can still start";
  }

  return { disabled, status };
}
