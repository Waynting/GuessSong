import { describe, it, expect } from "vitest";
import {
  ROOM_POLL_IDLE_AFTER_MS,
  ROOM_POLL_IDLE_INTERVAL_MS,
  ROOM_POLL_INTERVAL_MS,
  ROOM_POLL_SLOW_AFTER_MS,
  ROOM_POLL_SLOW_INTERVAL_MS,
  canPollAgainAfter,
  pollIntervalMs,
  pollTickAction,
} from "@/lib/room-poll";
import { ROOM_TTL_SECONDS } from "@/types/room";

/**
 * These bounds are what stops an abandoned browser tab from polling
 * `/api/room/[code]/status` forever at two Upstash commands a tick. None of
 * them is visible in the UI — a regression here looks like nothing at all until
 * the monthly quota is gone — so this file is the only thing guarding them.
 */
describe("pollTickAction", () => {
  const deadline = 1_000_000;

  it("fetches while the room is alive and the tab is visible", () => {
    expect(pollTickAction({ now: deadline - 1000, deadline, visible: true })).toBe("fetch");
  });

  it("skips the request in a background tab but stays scheduled", () => {
    // Not "stop": the loop has to survive so the roster is current when the
    // host comes back to the tab.
    expect(pollTickAction({ now: deadline - 1000, deadline, visible: false })).toBe("skip");
  });

  it("stops once the room's TTL has run out", () => {
    expect(pollTickAction({ now: deadline, deadline, visible: true })).toBe("stop");
    expect(pollTickAction({ now: deadline + 1, deadline, visible: true })).toBe("stop");
  });

  it("stops on the deadline even when the tab is hidden", () => {
    // The hidden-tab check must not shadow the deadline, or a backgrounded tab
    // would reschedule itself forever without ever reaching the stop.
    expect(pollTickAction({ now: deadline + 1, deadline, visible: false })).toBe("stop");
  });

  it("checks the deadline before spending a request on it", () => {
    // Asking at expiry would return the 404 the deadline already predicts.
    expect(pollTickAction({ now: deadline, deadline, visible: true })).not.toBe("fetch");
  });
});

describe("canPollAgainAfter", () => {
  it("stops on a room that is gone or already started", () => {
    expect(canPollAgainAfter(404)).toBe(false); // expired or never existed
    expect(canPollAgainAfter(410)).toBe(false); // consumed by Start
  });

  it("keeps polling through failures that clear by themselves", () => {
    // A 429 is our own limiter and stops; a 500 may be the KV outage in
    // docs/operations.md §5, which ends when the Upstash quota rolls over.
    // Treating either as terminal kills the roster on a party about to work.
    for (const status of [429, 500, 502, 503, 504]) {
      expect(canPollAgainAfter(status)).toBe(true);
    }
  });

  it("keeps polling on success", () => {
    expect(canPollAgainAfter(200)).toBe(true);
  });
});

describe("pollIntervalMs", () => {
  it("polls at the fast rung while the roster is still moving", () => {
    // The interval a host actually experiences: every arrival resets the clock,
    // so a room that is filling never leaves this rung.
    expect(pollIntervalMs(0)).toBe(ROOM_POLL_INTERVAL_MS);
    expect(pollIntervalMs(ROOM_POLL_SLOW_AFTER_MS - 1)).toBe(ROOM_POLL_INTERVAL_MS);
  });

  it("backs off once nobody has arrived for a while", () => {
    expect(pollIntervalMs(ROOM_POLL_SLOW_AFTER_MS)).toBe(ROOM_POLL_SLOW_INTERVAL_MS);
    expect(pollIntervalMs(ROOM_POLL_IDLE_AFTER_MS - 1)).toBe(ROOM_POLL_SLOW_INTERVAL_MS);
  });

  it("backs off further on a room nobody has touched in minutes", () => {
    expect(pollIntervalMs(ROOM_POLL_IDLE_AFTER_MS)).toBe(ROOM_POLL_IDLE_INTERVAL_MS);
    expect(pollIntervalMs(ROOM_TTL_SECONDS * 1000)).toBe(ROOM_POLL_IDLE_INTERVAL_MS);
  });

  it("errs towards the fast rung when the caller lost track of the clock", () => {
    // Erring this way costs commands; erring the other way leaves a host
    // watching a stale roster, which is the failure that matters.
    for (const bad of [Number.NaN, -1, Number.NEGATIVE_INFINITY]) {
      expect(pollIntervalMs(bad)).toBe(ROOM_POLL_INTERVAL_MS);
    }
  });

  it("never returns an interval that would poll faster than the fast rung", () => {
    // A ladder that inverted would be worse than no ladder — it would spend
    // *more* on exactly the idle rooms this exists to make cheap.
    for (let elapsed = 0; elapsed <= ROOM_TTL_SECONDS * 1000; elapsed += 5000) {
      expect(pollIntervalMs(elapsed)).toBeGreaterThanOrEqual(ROOM_POLL_INTERVAL_MS);
    }
  });
});

describe("poll budget", () => {
  /** Walks the real loop: tick, wait `pollIntervalMs`, tick, until it stops. */
  function ticksForAnIdleRoom(): number {
    const deadline = ROOM_TTL_SECONDS * 1000;
    const openedAt = 0;
    let now = 0;
    let ticks = 0;
    // Nothing ever arrives, so the ladder is only ever climbing — this is the
    // abandoned tab, which is the case that dominates the bill.
    while (pollTickAction({ now, deadline, visible: true }) !== "stop") {
      ticks++;
      now += pollIntervalMs(now - openedAt);
      if (ticks > 10_000) break; // never reached; guards a broken ladder
    }
    return ticks;
  }

  it("cannot outlive the room by more than one interval", () => {
    // The guarantee that bounds the total: ticks are capped at the room's TTL,
    // so one abandoned tab can never cost more than this many requests.
    const maxTicks = Math.ceil((ROOM_TTL_SECONDS * 1000) / ROOM_POLL_INTERVAL_MS);
    expect(ticksForAnIdleRoom()).toBeLessThanOrEqual(maxTicks);
  });

  it("costs an abandoned tab a fraction of what a flat interval did", () => {
    // The number this change exists to move. A flat 4s over a 30-minute TTL is
    // 450 ticks, i.e. 900 Upstash commands spent on a room whose roster stopped
    // changing in minute two. Pinned as a ratio rather than a literal so the
    // rungs can be retuned without rewriting the test — but not so loosely that
    // quietly reverting to a flat interval would still pass.
    const flat = Math.ceil((ROOM_TTL_SECONDS * 1000) / ROOM_POLL_INTERVAL_MS);
    expect(ticksForAnIdleRoom()).toBeLessThan(flat / 3);
  });

  it("still polls the first minute at full speed", () => {
    // The half that must not regress: the ladder is only allowed to be cheaper
    // where nothing is happening. While the room is filling it has to behave
    // exactly as it did before.
    let now = 0;
    let ticks = 0;
    while (now < ROOM_POLL_SLOW_AFTER_MS) {
      ticks++;
      now += pollIntervalMs(now);
    }
    expect(ticks).toBe(ROOM_POLL_SLOW_AFTER_MS / ROOM_POLL_INTERVAL_MS);
  });
});
