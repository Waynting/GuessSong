import { describe, it, expect } from "vitest";
import { createClipClock } from "@/lib/clip-clock";

/**
 * How much of a clip the room has heard. Every method takes the time, so
 * nothing here waits on a real clock.
 */
describe("a clip's window is counted in sound, not in wall clock", () => {
  it("counts an open segment as it runs", () => {
    const clock = createClipClock();
    clock.open(1_000);
    expect(clock.elapsed(1_000)).toBe(0);
    expect(clock.elapsed(4_500)).toBe(3_500);
    expect(clock.running()).toBe(true);
  });

  it("does not count the pause between two segments", () => {
    // A 15s clip paused for 20s must not end the moment it resumes.
    const clock = createClipClock();
    clock.open(0);
    clock.close(5_000);
    clock.open(25_000);
    expect(clock.elapsed(25_000)).toBe(5_000);
    expect(clock.elapsed(28_000)).toBe(8_000);
  });

  it("banks nothing when it is closed with no segment open", () => {
    // The hole this module exists to close. A buzz that lands while the
    // element is still loading pauses a clip that has not started; the
    // arithmetic this replaced would bank everything since the *previous*
    // segment began, and hand the clip back with its window already spent.
    const clock = createClipClock();
    clock.open(0);
    clock.close(2_000);
    clock.close(90_000);
    clock.close(180_000);
    expect(clock.elapsed(200_000)).toBe(2_000);
    expect(clock.running()).toBe(false);
  });

  it("banks nothing before the first segment either", () => {
    const clock = createClipClock();
    clock.close(60_000);
    expect(clock.elapsed(60_000)).toBe(0);
  });

  it("does not restart a segment that is already open", () => {
    // `playing` fires again after a stall; the sound before it still counts.
    const clock = createClipClock();
    clock.open(0);
    clock.open(4_000);
    expect(clock.elapsed(6_000)).toBe(6_000);
  });

  it("goes back to the top on reset, open segment and all", () => {
    const clock = createClipClock();
    clock.open(0);
    clock.close(7_000);
    clock.open(8_000);
    clock.reset();
    expect(clock.elapsed(20_000)).toBe(0);
    expect(clock.running()).toBe(false);
  });

  it("banks the whole window when it runs out, so a later Resume plays on", () => {
    const clock = createClipClock();
    clock.open(0);
    clock.spend(15_000);
    expect(clock.elapsed(15_010)).toBe(15_000);
    expect(clock.running()).toBe(false);
    // The host playing on past the window adds to it and never un-spends it.
    clock.open(20_000);
    clock.close(26_000);
    expect(clock.elapsed(26_000)).toBeGreaterThanOrEqual(15_000);
  });

  it("never un-hears part of a clip when the system clock steps backwards", () => {
    const clock = createClipClock();
    clock.open(10_000);
    expect(clock.elapsed(4_000)).toBe(0);
    clock.close(4_000);
    expect(clock.elapsed(4_000)).toBe(0);
  });
});
