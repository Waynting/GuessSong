/**
 * The browser half of `POST /api/pulse`.
 *
 * ## Why `sendBeacon` and not `fetch`
 *
 * Both events this sends happen immediately before the page goes away. A game
 * start is followed by `router.push("/game")`; an impression on the buzzer
 * page can be followed by the player tapping the call to action a second
 * later. A `fetch` in flight when a document tears down is cancelled, so the
 * measurement would be lost exactly in the cases worth measuring, and lost
 * silently — the number would simply read low and be mistaken for the thing it
 * was trying to detect.
 *
 * `navigator.sendBeacon` exists for this: the request is handed to the browser
 * and survives the unload. It gives no response and no error, which is fine —
 * nothing here is worth blocking a user for.
 */

import type { PulseEvent } from "@/lib/pulse";

const ENDPOINT = "/api/pulse";

/**
 * Best effort, always. Never throws, never awaits anything the caller needs.
 *
 * Returns whether the browser accepted the beacon for delivery, which is not
 * the same as it arriving — only useful for tests and for the fallback below.
 */
export function sendPulse(event: PulseEvent): boolean {
  if (typeof navigator === "undefined") return false;

  const body = JSON.stringify(event);

  try {
    if (typeof navigator.sendBeacon === "function") {
      // `text/plain` on purpose. A Blob typed `application/json` makes the
      // beacon a CORS-preflighted request in some browsers, and a preflight
      // cannot complete during unload — the exact moment this is being used.
      // Same origin, and the route reads the raw text, so the type is cosmetic.
      const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
      if (navigator.sendBeacon(ENDPOINT, blob)) return true;
    }
  } catch {
    // Some privacy modes make sendBeacon throw rather than return false.
  }

  // Fallback for browsers without sendBeacon, and for the case where it
  // refuses (the beacon queue is full). `keepalive` asks fetch for the same
  // survive-the-unload behaviour; it is weaker but better than nothing.
  try {
    void fetch(ENDPOINT, {
      method: "POST",
      body,
      keepalive: true,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
    }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}
