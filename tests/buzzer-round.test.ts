import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BuzzEntry, RoomSnapshot, ServerMessage } from "@/lib/buzzer-protocol";
import { buzzerRoundKey, describeBuzzer, floorKey, hostOpenWasLost, stateMissedBuzz } from "@/lib/buzzer-round";

const entry = (playerId: string, order: number): BuzzEntry => ({
  playerId,
  name: playerId.toUpperCase(),
  order,
  msSinceOpen: 400 * order,
});

const snap = (over: Partial<RoomSnapshot>): RoomSnapshot => ({
  code: "AB7K",
  phase: "open",
  roundIndex: 0,
  roundOpenedAt: 1_000,
  buzzes: [],
  players: [],
  expiresAt: 9_999_999,
  ...over,
});

describe("the player's pressed latch is scoped to the round", () => {
  it("clears on a phone that slept through round:open and woke to a locked round", () => {
    // The latch is held as the key of the round it was pressed in.
    const pressedIn = buzzerRoundKey(snap({ roundIndex: 2, roundOpenedAt: 1_000, phase: "locked", buzzes: [entry("me", 1)] }));
    // Screen locked; host pressed Next and Play; someone else buzzed; the
    // phone reconnects to a snapshot that never had the open-and-empty shape.
    const woke = snap({ roundIndex: 3, roundOpenedAt: 5_000, phase: "locked", buzzes: [entry("ann", 1)] });
    expect(buzzerRoundKey(woke)).not.toBe(pressedIn);
  });

  it("holds through the round's own changes, so a long-press is still one buzz", () => {
    const open = snap({ roundIndex: 4, roundOpenedAt: 7_000 });
    const locked = snap({ roundIndex: 4, roundOpenedAt: 7_000, phase: "locked", buzzes: [entry("ann", 1), entry("me", 2)] });
    expect(buzzerRoundKey(locked)).toBe(buzzerRoundKey(open));
  });

  it("clears when a wrong answer reopens the round for everyone", () => {
    expect(buzzerRoundKey(snap({ roundIndex: 4, roundOpenedAt: 8_000 }))).not.toBe(
      buzzerRoundKey(snap({ roundIndex: 4, roundOpenedAt: 7_000 }))
    );
  });

  it("is applied in the button instead of the phase-shape effect, and fed by the page", () => {
    const button = readFileSync(join(process.cwd(), "components/buzzer-button.tsx"), "utf8");
    expect(button).not.toMatch(/phase === "open" && buzzes\.length === 0/);
    expect(button).toMatch(/const pressed = pressedIn === round;/);
    expect(button).toMatch(/buzzerRoundKey\(/);
    const page = readFileSync(join(process.cwd(), "app/buzz/[code]/page.tsx"), "utf8");
    expect(page).toMatch(/roundIndex=\{snapshot\?\.roundIndex \?\? null\}/);
    expect(page).toMatch(/roundOpenedAt=\{snapshot\?\.roundOpenedAt \?\? null\}/);
  });
});

describe("the button never promises a queue the player cannot join", () => {
  const base = { connected: true, myBuzz: undefined, iWon: false, winner: entry("ann", 1) };

  it("says Sent while the player's own buzz is in flight behind someone else's", () => {
    const v = describeBuzzer({ ...base, phase: "locked", pressed: true });
    expect(v.disabled).toBe(true);
    expect(`${v.label} ${v.sub ?? ""}`).not.toMatch(/queue/);
  });

  it("names the winner between rounds without offering to queue", () => {
    const v = describeBuzzer({ ...base, phase: "idle", pressed: false });
    expect(v.label).toBe("ANN");
    expect(v.disabled).toBe(true);
    expect(`${v.label} ${v.sub ?? ""}`).not.toMatch(/queue/);
  });

  it("still offers the queue when the player can join it", () => {
    const v = describeBuzzer({ ...base, phase: "locked", pressed: false });
    expect(v.disabled).toBe(false);
    expect(v.sub).toMatch(/queue/);
  });
});

describe("a host:open that never reached the room is sent again", () => {
  const joinReply = (phase: RoomSnapshot["phase"], isHost = true): ServerMessage => ({
    type: "state",
    snapshot: snap({ phase, roundOpenedAt: phase === "idle" ? null : 1_000 }),
    you: { playerId: isHost ? "host" : "", isHost },
  });

  it("re-sends when the room answers the host's (re)join idle while the clip is running or held", () => {
    // Play tapped before /game's socket finished its handshake, or a Wi-Fi
    // blip during the backoff: send() dropped the frame, the guard never
    // re-sent it, and every phone read "Wait for the clip" all song.
    expect(hostOpenWasLost(joinReply("idle"), "playing")).toBe(true);
    expect(hostOpenWasLost(joinReply("idle"), "guessing")).toBe(true);
  });

  it("leaves a round that did open alone, and every phase where idle is right", () => {
    expect(hostOpenWasLost(joinReply("open"), "playing")).toBe(false);
    expect(hostOpenWasLost(joinReply("locked"), "guessing")).toBe(false);
    for (const phase of ["waiting", "revealed", "finished"]) {
      expect(hostOpenWasLost(joinReply("idle"), phase), phase).toBe(false);
    }
  });

  it("ignores host:next's broadcast, which a fast Next then Play receives after the new open went out", () => {
    expect(hostOpenWasLost(joinReply("idle", false), "playing")).toBe(false);
    expect(hostOpenWasLost({ type: "round:resolved", roundIndex: 0, verdict: "revealed" }, "playing")).toBe(false);
  });

  it("is wired into the host panel's message handler, through refs so the handler is not rebuilt", () => {
    const panel = readFileSync(join(process.cwd(), "components/buzzer-host-panel.tsx"), "utf8");
    const handler = panel.slice(panel.indexOf("const handleServerMessage = useCallback("), panel.indexOf("useBuzzerSocket({"));
    expect(handler).toMatch(/if \(hostOpenWasLost\(msg, gamePhaseRef\.current\)\) hostOpenRef\.current\(\);/);
    expect(panel).toMatch(/gamePhaseRef\.current = gamePhase;/);
    expect(panel).toMatch(/hostOpenRef\.current = hostOpen;/);
  });
});

describe("a buzz the host's socket missed still stops the music", () => {
  const replay = (snapshot: RoomSnapshot): ServerMessage => ({
    type: "state",
    snapshot,
    you: { playerId: "host", isHost: true },
  });
  const locked = (...buzzes: BuzzEntry[]) => snap({ phase: "locked", buzzes });

  it("pauses when the rejoin's replay shows a winner the host never saw", () => {
    // Clip running, room open, socket drops; Ann buzzes in the gap.
    const before = floorKey(snap({ phase: "open" }));
    expect(before).toBeNull();
    expect(stateMissedBuzz(replay(locked(entry("ann", 1))), before)).toBe(true);
  });

  it("pauses for a new head the host missed, after a wrong answer it did see", () => {
    const seen = floorKey(locked(entry("ann", 1), entry("bob", 2)));
    expect(stateMissedBuzz(replay(locked(entry("bob", 2))), seen)).toBe(true);
  });

  it("leaves music the host resumed alone when the replay shows the same head", () => {
    const seen = floorKey(locked(entry("bob", 2)));
    expect(stateMissedBuzz(replay(locked(entry("bob", 2))), seen)).toBe(false);
    // A re-keyed seat changes the id, not the buzz.
    expect(stateMissedBuzz(replay(locked({ ...entry("bob", 2), playerId: "bob-new" })), seen)).toBe(false);
  });

  it("reads a replay after a manual reconnect against the floor from before it", () => {
    // Host resumed for Bob after a wrong answer, then tapped "Try again": the
    // snapshot is null in between, and the floor must survive it.
    let floor: string | null = null;
    const render = (s: RoomSnapshot | null) => {
      if (s) floor = floorKey(s);
    };
    render(locked(entry("bob", 2)));
    render(null);
    expect(stateMissedBuzz(replay(locked(entry("bob", 2))), floor)).toBe(false);
  });

  it("tells the same order apart across rounds", () => {
    const lastRound = floorKey(snap({ phase: "locked", roundIndex: 1, buzzes: [entry("ann", 1)] }));
    const thisRound = snap({ phase: "locked", roundIndex: 2, roundOpenedAt: 7_000, buzzes: [entry("ann", 1)] });
    expect(stateMissedBuzz(replay(thisRound), lastRound)).toBe(true);
  });

  it("ignores replays with nobody on the floor, and every other message", () => {
    expect(stateMissedBuzz(replay(snap({ phase: "open" })), null)).toBe(false);
    expect(stateMissedBuzz(replay(snap({ phase: "idle", buzzes: [entry("ann", 1)] })), null)).toBe(false);
    expect(stateMissedBuzz({ type: "buzz", entry: entry("ann", 1), phase: "locked" }, null)).toBe(false);
  });

  it("is wired into the host panel, reading the floor from before the message", () => {
    const panel = readFileSync(join(process.cwd(), "components/buzzer-host-panel.tsx"), "utf8");
    const handler = panel.slice(panel.indexOf("const handleServerMessage = useCallback("), panel.indexOf("useBuzzerSocket({"));
    expect(handler).toMatch(/if \(stateMissedBuzz\(msg, floorRef\.current\)\) onBuzz\?\.\(\);/);
    // Only a snapshot overwrites the floor: "Try again" nulls the snapshot
    // before the replay, and a floor reset to null there reads the same head
    // as a new one and pauses music the host resumed.
    expect(panel).toMatch(/if \(snapshot\) floorRef\.current = floorKey\(snapshot\);/);
    expect(panel).not.toMatch(/floorRef\.current = snapshot \?/);
  });
});
