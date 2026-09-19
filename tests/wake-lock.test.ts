// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { useScreenWakeLock } from "@/lib/wake-lock";

/**
 * The hook that keeps the host's phone awake, run for real.
 *
 * tests/mobile.test.ts pins that the game page calls it and that the hook
 * names the two API calls it rests on; this file runs the hook's own logic,
 * which is where the bugs would be. Every branch in lib/wake-lock.ts exists
 * because a phone does something the desktop never does — hides the tab and
 * takes the lock with it, refuses the request on low battery, has no API at
 * all — and every one of those fails silently by design, so the only way to
 * know the silence is the right silence is to drive each case and count
 * what the hook asked the browser for.
 *
 * The page is a client component vitest cannot import, but the hook is a
 * plain module, so a one-line component that calls it is rendered with
 * react-dom under jsdom; `navigator.wakeLock` is a stub that records every
 * request and hands back a sentinel whose `release` and `released` the test
 * controls.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type FakeSentinel = {
  released: boolean;
  releaseCalls: number;
  release: () => Promise<void>;
};

/** A sentinel the way the browser hands one over: held until released, released once told to. */
function fakeSentinel(release: () => Promise<void> = () => Promise.resolve()): FakeSentinel {
  const s: FakeSentinel = {
    released: false,
    releaseCalls: 0,
    release() {
      s.releaseCalls += 1;
      s.released = true;
      return release();
    },
  };
  return s;
}

/**
 * Installs a `navigator.wakeLock` whose every `request` is recorded and
 * answered by `answer`. Configurable so a test can delete it again.
 */
function installWakeLock(answer: () => Promise<FakeSentinel>): string[] {
  const requests: string[] = [];
  Object.defineProperty(navigator, "wakeLock", {
    value: {
      request(type: string) {
        requests.push(type);
        return answer();
      },
    },
    configurable: true,
    writable: true,
  });
  return requests;
}

function uninstallWakeLock(): void {
  delete (navigator as unknown as { wakeLock?: unknown }).wakeLock;
}

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

function resetVisibility(): void {
  delete (document as unknown as { visibilityState?: unknown }).visibilityState;
}

/** Lets every promise the hook is waiting on settle: the request, then the assignment after it. */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function Probe({ active }: { active: boolean }) {
  useScreenWakeLock(active);
  return null;
}

type Mounted = {
  rerender: (active: boolean) => Promise<void>;
  unmount: () => Promise<void>;
};

/** Every mount is tracked, so afterEach can unmount whatever a failing test left behind. */
const mounted: Mounted[] = [];

async function mountTracked(active: boolean): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = (a: boolean) =>
    act(async () => {
      root.render(createElement(Probe, { active: a }));
    });
  await render(active);
  const m: Mounted = {
    rerender: render,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
  mounted.push(m);
  return m;
}

afterEach(async () => {
  for (const m of mounted.splice(0)) await m.unmount().catch(() => {});
  uninstallWakeLock();
  resetVisibility();
  vi.restoreAllMocks();
});

describe("the lock is asked for exactly when it can help", () => {
  it("asks for a screen lock on mount and holds the sentinel", async () => {
    // The happy path, and the type is "screen": a "system" lock is a
    // different permission and Chrome refuses it outright.
    const sentinel = fakeSentinel();
    const requests = installWakeLock(() => Promise.resolve(sentinel));
    await mountTracked(true);
    await flush();
    expect(requests).toEqual(["screen"]);
    expect(sentinel.released).toBe(false);
  });

  it("asks for nothing while inactive", async () => {
    // The game page passes `tracks.length > 0`: until the payload has been
    // read from sessionStorage there is no game to keep the screen on for,
    // and a host bounced back to `/` must not leave a lock behind.
    const requests = installWakeLock(() => Promise.resolve(fakeSentinel()));
    const add = vi.spyOn(document, "addEventListener");
    await mountTracked(false);
    await flush();
    expect(requests).toEqual([]);
    expect(add.mock.calls.filter(([type]) => type === "visibilitychange")).toEqual([]);
  });

  it("starts asking once it becomes active, and lets go when it stops", async () => {
    // `active` is a dependency, not a one-shot: the effect re-runs on the
    // flip, and the cleanup of the active run is what releases the lock.
    const sentinel = fakeSentinel();
    const requests = installWakeLock(() => Promise.resolve(sentinel));
    const m = await mountTracked(false);
    await flush();
    expect(requests).toEqual([]);
    await m.rerender(true);
    await flush();
    expect(requests).toEqual(["screen"]);
    await m.rerender(false);
    await flush();
    expect(sentinel.releaseCalls).toBe(1);
  });

  it("does nothing, and does not throw, on a browser without the API", async () => {
    // Safari before 16.4, Firefox, and most webviews. `"wakeLock" in
    // navigator` is the guard; reading `navigator.wakeLock.request` on those
    // would be a TypeError inside a mount effect, which is the crash screen
    // for every host on an older phone — for a feature that only ever helps.
    uninstallWakeLock();
    expect("wakeLock" in navigator).toBe(false);
    const add = vi.spyOn(document, "addEventListener");
    await expect(mountTracked(true)).resolves.toBeDefined();
    await flush();
    // No listener either: with no API, there is nothing a return to the
    // foreground could re-request.
    expect(add.mock.calls.filter(([type]) => type === "visibilitychange")).toEqual([]);
  });

  it("swallows a refused request", async () => {
    // Low battery, a permissions policy, a hidden document at the moment of
    // the request: the promise rejects with a NotAllowedError. Vitest fails
    // the run on an unhandled rejection, so this passing is the proof.
    const requests = installWakeLock(() => Promise.reject(new DOMException("denied", "NotAllowedError")));
    await mountTracked(true);
    await flush();
    expect(requests).toEqual(["screen"]);
  });
});

describe("the lock survives the tab being hidden", () => {
  it("asks again when the tab comes back after the browser released the lock", async () => {
    // The browser releases the lock whenever the document is hidden — the
    // lock button, a notification, another app — and never hands it back.
    // Without the re-request, the first notification the host reads ends
    // the lock for the rest of the evening.
    const first = fakeSentinel();
    const second = fakeSentinel();
    const answers = [first, second];
    const requests = installWakeLock(() => Promise.resolve(answers.shift()!));
    await mountTracked(true);
    await flush();
    expect(requests).toEqual(["screen"]);

    // What the browser does on hide: marks the sentinel released. The hook
    // must not release it itself here; there is nothing to release.
    first.released = true;
    setVisibility("hidden");
    await flush();
    expect(requests).toEqual(["screen"]);
    expect(first.releaseCalls).toBe(0);

    setVisibility("visible");
    await flush();
    expect(requests).toEqual(["screen", "screen"]);
    expect(second.released).toBe(false);
  });

  it("does not ask twice while the sentinel it holds is still live", async () => {
    // A visibilitychange to visible with the lock intact — a desktop
    // browser that fires the event without dropping the lock, or a second
    // event for one transition — must not stack a second sentinel that
    // nothing will release.
    const sentinel = fakeSentinel();
    const requests = installWakeLock(() => Promise.resolve(sentinel));
    await mountTracked(true);
    await flush();
    setVisibility("visible");
    await flush();
    setVisibility("visible");
    await flush();
    expect(requests).toEqual(["screen"]);
  });

  it("ignores the change to hidden", async () => {
    // A request while hidden is refused anyway (the spec says so), and a
    // refusal here would be one wasted round trip per lock of the phone.
    const sentinel = fakeSentinel();
    const requests = installWakeLock(() => Promise.resolve(sentinel));
    await mountTracked(true);
    await flush();
    sentinel.released = true;
    setVisibility("hidden");
    await flush();
    expect(requests).toEqual(["screen"]);
  });

  it("asks again after a refusal once the tab is visible", async () => {
    // A request that failed left no sentinel, so a later return to the
    // foreground is a fresh chance — low battery is not forever.
    const sentinel = fakeSentinel();
    let attempts = 0;
    const requests = installWakeLock(() =>
      ++attempts === 1 ? Promise.reject(new DOMException("denied", "NotAllowedError")) : Promise.resolve(sentinel),
    );
    await mountTracked(true);
    await flush();
    setVisibility("visible");
    await flush();
    expect(requests).toEqual(["screen", "screen"]);
    expect(sentinel.released).toBe(false);
  });
});

describe("one request in flight at a time", () => {
  it("asks once when the tab comes back while the first request is still in flight", async () => {
    // A host who locks the phone as the game loads: visibilitychange fires
    // while the mount request is unresolved and `sentinel` is still null.
    // Without the in-flight guard both calls asked, the last to resolve took
    // the slot, and the cleanup released only that one — the other held the
    // screen on whatever page came after Play Again. The single request
    // must be the one the unmount releases.
    const first = Promise.withResolvers<FakeSentinel>();
    const a = fakeSentinel();
    const requests = installWakeLock(() => first.promise);
    const m = await mountTracked(true);
    setVisibility("visible");
    await flush();
    expect(requests).toEqual(["screen"]);
    await act(async () => {
      first.resolve(a);
    });
    await flush();
    await m.unmount();
    await flush();
    expect(a.releaseCalls).toBe(1);
  });

  it("asks once more when the tab came back while a request that then failed was in flight", async () => {
    // The tab hides and shows inside the mount request's few milliseconds.
    // The visible-again event finds a request in flight and is turned away;
    // then the request is refused, because the document was hidden when
    // the browser answered it. Without the retry nobody asks again until
    // the next hide/show, and the screen locks mid-clip.
    const first = Promise.withResolvers<FakeSentinel>();
    const b = fakeSentinel();
    const answers = [first.promise, Promise.resolve(b)];
    const requests = installWakeLock(() => answers.shift()!);
    await mountTracked(true);
    setVisibility("visible");
    await flush();
    expect(requests).toEqual(["screen"]);
    await act(async () => {
      first.reject(new Error("NotAllowedError"));
    });
    await flush();
    expect(requests).toEqual(["screen", "screen"]);
    expect(b.released).toBe(false);
  });

  it("does not retry a refusal nobody asked about again", async () => {
    // The retry is for a visible-again event that was turned away, not for
    // every refusal: a phone on low battery refuses every request, and a
    // hook that asked again on each refusal would loop.
    const first = Promise.withResolvers<FakeSentinel>();
    const requests = installWakeLock(() => first.promise);
    await mountTracked(true);
    await act(async () => {
      first.reject(new Error("NotAllowedError"));
    });
    await flush();
    expect(requests).toEqual(["screen"]);
  });

  it("does not retry after the page has gone, even when a visible event was turned away", async () => {
    // Mutation-checked: without `!cancelled` on the retry this passes a
    // request into a page that has already left for `/`.
    const first = Promise.withResolvers<FakeSentinel>();
    const requests = installWakeLock(() => first.promise);
    const m = await mountTracked(true);
    setVisibility("visible");
    await flush();
    expect(requests).toEqual(["screen"]);
    await m.unmount();
    await act(async () => {
      first.reject(new Error("NotAllowedError"));
    });
    await flush();
    expect(requests).toEqual(["screen"]);
  });

  it("does not retry into a hidden tab, even when a visible event was turned away", async () => {
    // The tab came back and went away again before the request settled;
    // a request into a hidden document is refused, so asking is waste.
    const first = Promise.withResolvers<FakeSentinel>();
    const requests = installWakeLock(() => first.promise);
    await mountTracked(true);
    setVisibility("visible");
    setVisibility("hidden");
    await flush();
    expect(requests).toEqual(["screen"]);
    await act(async () => {
      first.reject(new Error("NotAllowedError"));
    });
    await flush();
    expect(requests).toEqual(["screen"]);
  });

  it("retries once, not until the battery says yes", async () => {
    // A turned-away visible event buys one retry. Without `wanted = false`
    // before it, a phone that refuses every request is asked forever.
    const first = Promise.withResolvers<FakeSentinel>();
    const second = Promise.withResolvers<FakeSentinel>();
    const answers = [first.promise, second.promise];
    // A third request must sit in flight, not reject: an always-refusing
    // stub under a looping hook starves the event loop and the test hangs.
    const requests = installWakeLock(() => answers.shift() ?? new Promise<FakeSentinel>(() => {}));
    await mountTracked(true);
    setVisibility("visible");
    await flush();
    await act(async () => {
      first.reject(new Error("NotAllowedError"));
    });
    await flush();
    expect(requests).toEqual(["screen", "screen"]);
    await act(async () => {
      second.reject(new Error("NotAllowedError"));
    });
    await flush();
    expect(requests).toEqual(["screen", "screen"]);
  });

  it("asks again after an in-flight request is refused", async () => {
    // The guard must clear on the failure path too, or one refusal at mount
    // would make every later return to the tab a no-op.
    const first = Promise.withResolvers<FakeSentinel>();
    const b = fakeSentinel();
    const answers = [first.promise, Promise.resolve(b)];
    const requests = installWakeLock(() => answers.shift()!);
    await mountTracked(true);
    await act(async () => {
      first.reject(new Error("NotAllowedError"));
    });
    await flush();
    setVisibility("visible");
    await flush();
    expect(requests).toEqual(["screen", "screen"]);
    expect(b.released).toBe(false);
  });
});

describe("leaving the game lets the screen go", () => {
  it("releases the sentinel and stops listening on unmount", async () => {
    // Play Again is a client-side navigation to `/`; the page unmounts and
    // the host's setup screen must be an ordinary page again. Two things are
    // proven by the second half: the listener is gone (a visible event after
    // unmount asks for nothing) and so is the closure's sentinel.
    const sentinel = fakeSentinel();
    const requests = installWakeLock(() => Promise.resolve(sentinel));
    const m = await mountTracked(true);
    await flush();
    await m.unmount();
    expect(sentinel.releaseCalls).toBe(1);
    expect(sentinel.released).toBe(true);
    setVisibility("visible");
    await flush();
    expect(requests).toEqual(["screen"]);
  });

  it("releases a lock that resolves after the page has already gone", async () => {
    // The request is asynchronous and the host can leave during it — End
    // Game on a game that just loaded, or the redirect to `/`. A sentinel
    // that lands on a dead effect would be held until the tab is hidden,
    // with nothing left that could release it.
    const pending = Promise.withResolvers<FakeSentinel>();
    const sentinel = fakeSentinel();
    installWakeLock(() => pending.promise);
    const m = await mountTracked(true);
    await m.unmount();
    expect(sentinel.releaseCalls).toBe(0);
    await act(async () => {
      pending.resolve(sentinel);
    });
    await flush();
    expect(sentinel.releaseCalls).toBe(1);
  });

  it("swallows a release that rejects on unmount", async () => {
    // `release()` can reject on a sentinel the browser already dropped.
    // The cleanup runs inside React's commit; a rejection escaping it is an
    // unhandled rejection at best and, in older React, an error boundary.
    const sentinel = fakeSentinel(() => Promise.reject(new Error("already released")));
    installWakeLock(() => Promise.resolve(sentinel));
    const m = await mountTracked(true);
    await flush();
    await expect(m.unmount()).resolves.toBeUndefined();
    await flush();
    expect(sentinel.releaseCalls).toBe(1);
  });

  it("swallows a release that rejects on the cancelled path", async () => {
    // Same rule for the late-arriving lock: its release is awaited inside
    // the request's own try, so a rejection there is caught with the rest.
    const pending = Promise.withResolvers<FakeSentinel>();
    const sentinel = fakeSentinel(() => Promise.reject(new Error("already released")));
    installWakeLock(() => pending.promise);
    const m = await mountTracked(true);
    await m.unmount();
    await act(async () => {
      pending.resolve(sentinel);
    });
    await flush();
    expect(sentinel.releaseCalls).toBe(1);
  });
});
