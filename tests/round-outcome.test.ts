import { describe, it, expect } from "vitest";
import { announcesNoScore } from "@/lib/round-outcome";

/**
 * The rule behind Next Track telling the room nobody scored. It replaced a
 * "No one" button, so every gate here is a case that button used to make
 * the host decide by hand.
 */
describe("announcesNoScore — when Next Track must tell the room nobody scored", () => {
  const base = { phase: "revealed" as const, pointsAwarded: false, buzzesPending: 0 };

  it("fires when the answer is up, nothing is awarded and no buzz is waiting", () => {
    expect(announcesNoScore(base)).toBe(true);
  });

  it("stays silent while a buzz is still waiting on a verdict", () => {
    expect(announcesNoScore({ ...base, buzzesPending: 1 })).toBe(false);
    expect(announcesNoScore({ ...base, buzzesPending: 3 })).toBe(false);
  });

  it("stays silent once the song point has been given", () => {
    expect(announcesNoScore({ ...base, pointsAwarded: true })).toBe(false);
  });

  it("stays silent on a skip from any phase before the reveal", () => {
    for (const phase of ["waiting", "playing", "guessing"] as const) {
      expect(announcesNoScore({ ...base, phase }), phase).toBe(false);
    }
  });

  it("stays silent once the game is over", () => {
    expect(announcesNoScore({ ...base, phase: "finished" })).toBe(false);
  });
});
