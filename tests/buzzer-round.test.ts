import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BuzzEntry, RoomSnapshot } from "@/lib/buzzer-protocol";
import { buzzerRoundKey, describeBuzzer } from "@/lib/buzzer-round";

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
