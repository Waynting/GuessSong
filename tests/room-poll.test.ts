import { describe, it, expect } from "vitest";
import {
  ROOM_POLL_INTERVAL_MS,
  canPollAgainAfter,
  pollTickAction,
} from "@/lib/room-poll";
import { ROOM_TTL_SECONDS } from "@/types/room";

/**
 * These three bounds are what stops an abandoned browser tab from polling
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

describe("poll budget", () => {
  it("cannot outlive the room by more than one interval", () => {
    // The guarantee that bounds the cost: ticks are capped at the room's TTL,
    // so one abandoned tab can never cost more than this many requests.
    const maxTicks = Math.ceil((ROOM_TTL_SECONDS * 1000) / ROOM_POLL_INTERVAL_MS);
    const deadline = ROOM_TTL_SECONDS * 1000;

    let now = 0;
    let ticks = 0;
    while (pollTickAction({ now, deadline, visible: true }) !== "stop") {
      ticks++;
      now += ROOM_POLL_INTERVAL_MS;
      if (ticks > maxTicks + 1) break;
    }

    expect(ticks).toBeLessThanOrEqual(maxTicks);
  });
});
