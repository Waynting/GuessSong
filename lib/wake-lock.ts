import { useEffect } from "react";

/**
 * Keeps the screen on while `active`.
 *
 * The host's phone is the game's only screen and, more often than not, its
 * speaker. A phone left alone for the length of a guess dims and then locks,
 * and a locked iPhone pauses whatever the page was playing — the clip stops
 * mid-round and the host wakes the phone to find a paused game and a dark
 * card. A screen wake lock is the fix the platform offers for exactly this,
 * and it costs nothing when it is refused.
 *
 * Two things about the API shape this leans on:
 *
 * - The browser releases the lock on its own whenever the tab is hidden
 *   (another app, the lock button, a notification tapped), and never hands
 *   it back. So the lock is re-requested on every return to the foreground,
 *   which is the only time a request can succeed anyway.
 * - Every failure is silent by design. The API is absent on older browsers,
 *   refused on low battery, and blocked inside some webviews, and none of
 *   that is the host's problem to hear about; the game plays exactly as it
 *   did before this existed.
 */
export function useScreenWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    // One request in flight at a time. The mount request takes a few ms, and
    // a tab that hides and shows inside them fires visibilitychange while
    // `sentinel` is still null — so both calls asked, whichever resolved last
    // won the slot, and the cleanup released only that one. The other stayed
    // held until the browser next hid the tab: the screen kept on, on
    // whatever page came after Play Again.
    let requesting = false;
    // The other half of that: a request in flight when the tab hides is
    // refused (the browser answers a hidden document with NotAllowedError),
    // and the visible-again event that would have re-asked arrived while it
    // was in flight and was turned away. Remembered, and asked once more
    // when the refusal lands.
    let wanted = false;

    async function acquire(): Promise<void> {
      if (sentinel && !sentinel.released) return;
      if (requesting) {
        wanted = true;
        return;
      }
      requesting = true;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (cancelled) {
          await lock.release();
          return;
        }
        sentinel = lock;
      } catch {
        // Refused or unsupported: the screen behaves as it always did.
      } finally {
        requesting = false;
        if (wanted) {
          wanted = false;
          if (!cancelled && document.visibilityState === "visible") void acquire();
        }
      }
    }

    function onVisibility(): void {
      if (document.visibilityState === "visible") void acquire();
    }

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
