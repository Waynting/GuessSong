import { describe, it, expect } from "vitest";
import { MIXED_MIN_CONTRIBUTORS, startState, type StartInputs } from "@/lib/start-status";

/**
 * The line under the Start button is the only thing that tells a host why the
 * button will not press, and the button being live is the only thing that
 * tells them it will. Neither is visible to any other test — the page is a
 * `.tsx` module the suite cannot import — so the strings are pinned here
 * exactly as the host reads them, and the order in which the ladder picks one
 * when several conditions hold is pinned with them.
 */

/**
 * A setup page with nothing waiting: single playlist, no buzzer, no room,
 * nothing in flight. Each scenario names only what it changes.
 *
 * `needsRoom` is derived the way `app/page.tsx` derives it, because the page
 * is the only caller and never hands the ladder anything else; a test that
 * passed `needsRoom: false` for a QR mix would be describing a page that does
 * not exist.
 */
function inputs(over: Partial<StartInputs> = {}): StartInputs {
  const base: StartInputs = {
    setupMode: "single",
    mixedSubMode: "room",
    busy: false,
    needsRoom: false,
    roomOpen: false,
    buzzerEnabled: false,
    buzzerPlayerCount: 0,
    mixedContributions: 0,
    roomSubmissions: 0,
    ...over,
  };
  const collectsPlaylists = base.setupMode === "mixed" && base.mixedSubMode === "room";
  return { ...base, needsRoom: over.needsRoom ?? (collectsPlaylists || base.buzzerEnabled) };
}

const ready = { disabled: false, status: null };

describe("single playlist", () => {
  it("is ready with nothing under the button", () => {
    expect(startState(inputs())).toEqual(ready);
  });

  it("stays ready with a half-built mix left behind", () => {
    // Neither roster is read in single mode: a host who switched back from
    // a mix short of the minimum must not be held by it.
    expect(startState(inputs({ mixedContributions: 1, roomSubmissions: 1 }))).toEqual(ready);
  });
});

describe("busy", () => {
  it("disables the button and says nothing — the spinner on the button says enough", () => {
    expect(startState(inputs({ busy: true }))).toEqual({ disabled: true, status: null });
  });

  it("says nothing even when the roster is short, so two things never explain one wait", () => {
    // A start in flight from a QR mix: the pool is being built from what
    // arrived, and "Waiting for 1 more playlist" under a spinner would
    // contradict the button it sits under.
    const short = inputs({ setupMode: "mixed", mixedSubMode: "room", roomOpen: true, roomSubmissions: 1, busy: true });
    expect(startState(short)).toEqual({ disabled: true, status: null });
    const noRoom = inputs({ buzzerEnabled: true, busy: true });
    expect(startState(noRoom)).toEqual({ disabled: true, status: null });
  });
});

describe("mixed, pass the phone", () => {
  const phone = (n: number, over: Partial<StartInputs> = {}) =>
    startState(inputs({ setupMode: "mixed", mixedSubMode: "phone", mixedContributions: n, ...over }));

  it("asks for the missing players by count, singular and plural", () => {
    expect(phone(MIXED_MIN_CONTRIBUTORS - 1)).toEqual({ disabled: true, status: "Add 1 more player to start" });
    expect(phone(MIXED_MIN_CONTRIBUTORS - 2)).toEqual({ disabled: true, status: "Add 2 more players to start" });
  });

  it("is ready at the minimum, and stays ready above it", () => {
    expect(phone(MIXED_MIN_CONTRIBUTORS)).toEqual(ready);
    expect(phone(MIXED_MIN_CONTRIBUTORS + 3)).toEqual(ready);
  });

  it("needs no room when the buzzer is off, so nothing asks for one", () => {
    // Pass-the-phone with the buzzer off never opens a room; "Open the room
    // first" here would point at a panel that is not on screen.
    expect(phone(MIXED_MIN_CONTRIBUTORS, { roomOpen: false })).toEqual(ready);
  });

  it("ignores the QR roster, which is the other mix's", () => {
    expect(phone(0, { roomSubmissions: 5 })).toEqual({ disabled: true, status: "Add 2 more players to start" });
  });

  it("asks for the room when the buzzer is on, even with a full roster", () => {
    // The one case where a phone mix falls through to the room line: the
    // players are all in, but the buzzer needs its room opened first.
    expect(phone(MIXED_MIN_CONTRIBUTORS, { buzzerEnabled: true, roomOpen: false })).toEqual({
      disabled: true,
      status: "Open the room first",
    });
    expect(phone(MIXED_MIN_CONTRIBUTORS, { buzzerEnabled: true, roomOpen: true, buzzerPlayerCount: 1 })).toEqual({
      disabled: false,
      status: "1 phone ready",
    });
  });
});

describe("mixed, QR room", () => {
  const room = (n: number, over: Partial<StartInputs> = {}) =>
    startState(inputs({ setupMode: "mixed", mixedSubMode: "room", roomOpen: true, roomSubmissions: n, ...over }));

  it("asks for the room to be opened before anything else about it", () => {
    expect(startState(inputs({ setupMode: "mixed", mixedSubMode: "room", roomOpen: false }))).toEqual({
      disabled: true,
      status: "Open the room first",
    });
  });

  it("counts playlists, not players, singular and plural", () => {
    // The host is a player too but scans nothing, so counting people read
    // as "wait for another guest" when what was missing was the host's own
    // playlist.
    expect(room(MIXED_MIN_CONTRIBUTORS - 1)).toEqual({ disabled: true, status: "Waiting for 1 more playlist" });
    expect(room(MIXED_MIN_CONTRIBUTORS - 2)).toEqual({ disabled: true, status: "Waiting for 2 more playlists" });
    expect(room(0).status).not.toMatch(/player/);
  });

  it("is ready at the minimum, and stays ready above it", () => {
    expect(room(MIXED_MIN_CONTRIBUTORS)).toEqual(ready);
    expect(room(MIXED_MIN_CONTRIBUTORS + 10)).toEqual(ready);
  });

  it("ignores the pass-the-phone roster, which is the other mix's", () => {
    expect(room(0, { mixedContributions: 5 })).toEqual({ disabled: true, status: "Waiting for 2 more playlists" });
  });
});

describe("single playlist with the buzzer on", () => {
  const buzzer = (phones: number, over: Partial<StartInputs> = {}) =>
    startState(inputs({ buzzerEnabled: true, roomOpen: true, buzzerPlayerCount: phones, ...over }));

  it("needs the room open first", () => {
    expect(startState(inputs({ buzzerEnabled: true, roomOpen: false }))).toEqual({
      disabled: true,
      status: "Open the room first",
    });
  });

  it("can start with nobody scanned in, and says so", () => {
    // Not a minimum player count: latecomers can scan in mid-game, and
    // holding the button on an arbitrary number would strand a host whose
    // friends are still finding the QR. The line is information, not a wait.
    expect(buzzer(0)).toEqual({ disabled: false, status: "Nobody has scanned yet — you can still start" });
  });

  it("counts the phones, singular and plural, and stays ready", () => {
    expect(buzzer(1)).toEqual({ disabled: false, status: "1 phone ready" });
    expect(buzzer(3)).toEqual({ disabled: false, status: "3 phones ready" });
  });

  it("reports the phones under a full mix too, either way the mix was built", () => {
    // Once a mix has its playlists there is nothing left to wait for, and
    // the buzzer's count is the next most useful thing to say.
    expect(
      startState(inputs({ setupMode: "mixed", mixedSubMode: "room", roomOpen: true, roomSubmissions: 2, buzzerEnabled: true, buzzerPlayerCount: 2 }))
    ).toEqual({ disabled: false, status: "2 phones ready" });
    expect(
      startState(inputs({ setupMode: "mixed", mixedSubMode: "phone", roomOpen: true, mixedContributions: 2, buzzerEnabled: true, buzzerPlayerCount: 0 }))
    ).toEqual({ disabled: false, status: "Nobody has scanned yet — you can still start" });
  });
});

describe("when several things hold at once, the host is told one, in the order they can act on it", () => {
  // Every condition true at once: a QR mix with the buzzer on, room not open,
  // nothing arrived, and a start in flight. Peel them off one at a time.
  const everything = inputs({
    setupMode: "mixed",
    mixedSubMode: "room",
    busy: true,
    roomOpen: false,
    buzzerEnabled: true,
    buzzerPlayerCount: 0,
    roomSubmissions: 0,
    mixedContributions: 0,
  });

  it("busy wins over everything", () => {
    expect(startState(everything)).toEqual({ disabled: true, status: null });
  });

  it("then a short pass-the-phone roster, which is fixed on this screen without a room", () => {
    const phone = inputs({ ...everything, busy: false, mixedSubMode: "phone" });
    expect(phone.needsRoom).toBe(true); // buzzer on
    expect(startState(phone)).toEqual({ disabled: true, status: "Add 2 more players to start" });
  });

  it("then an unopened room, which has to exist before anything can arrive in it", () => {
    expect(startState({ ...everything, busy: false })).toEqual({ disabled: true, status: "Open the room first" });
  });

  it("then a short QR roster", () => {
    expect(startState({ ...everything, busy: false, roomOpen: true })).toEqual({
      disabled: true,
      status: "Waiting for 2 more playlists",
    });
  });

  it("and the buzzer's line last, once there is nothing left to wait for", () => {
    expect(startState({ ...everything, busy: false, roomOpen: true, roomSubmissions: 2 })).toEqual({
      disabled: false,
      status: "Nobody has scanned yet — you can still start",
    });
  });

  it("never enables the button while it shows a wait", () => {
    // The buzzer's two lines are the only status a live button may carry.
    const waits = [
      inputs({ setupMode: "mixed", mixedSubMode: "phone", mixedContributions: 1 }),
      inputs({ setupMode: "mixed", mixedSubMode: "room", roomOpen: false }),
      inputs({ setupMode: "mixed", mixedSubMode: "room", roomOpen: true, roomSubmissions: 1 }),
      inputs({ buzzerEnabled: true, roomOpen: false }),
    ];
    for (const w of waits) {
      const s = startState(w);
      expect(s.status, JSON.stringify(w)).not.toBeNull();
      expect(s.disabled, JSON.stringify(w)).toBe(true);
    }
  });
});

describe("MIXED_MIN_CONTRIBUTORS", () => {
  it("is two, and is the one number both the button and the refusal read", () => {
    // `handleMixedStart` in app/page.tsx refuses below this with
    // `mixed_min_contributors`; the ladder holds the button until it is met.
    // The wording under the button is pinned above against this value, so a
    // change here fails there too, which is the point of pinning it.
    expect(MIXED_MIN_CONTRIBUTORS).toBe(2);
  });
});
