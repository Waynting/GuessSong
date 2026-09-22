import { describe, it, expect, afterEach, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { installQuotaStorage, installStorage, installThrowingStorage, uninstallStorage } from "./helpers/storage";
import { buildGamePayload, parseGamePayload, mergeRoomRoster } from "@/lib/game-session";
import {
  __resetPlayerIdForTests,
  getPersistentPlayerId,
  mintPlayerId,
  reduce,
  socketUrl,
  type BuzzerSocketState,
} from "@/lib/use-buzzer-socket";
import { buzzerJoinUrl, createBuzzerRoom, isBuzzerConfigured } from "@/lib/buzzer-client";
import { BUZZER_CLIENT_ERROR_CODES } from "@/lib/error-messages";
import {
  parseClientMessage,
  type BuzzEntry,
  type RoomSnapshot,
  type ServerMessage,
} from "@/lib/buzzer-protocol";

const emptyState: BuzzerSocketState = {
  snapshot: null,
  isHost: false,
  connected: false,
  error: null,
};

function snapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "AB7K",
    phase: "idle",
    roundIndex: 0,
    roundOpenedAt: null,
    buzzes: [],
    players: [],
    expiresAt: 1_000_000,
    ...overrides,
  };
}

function entry(name: string, order: number): BuzzEntry {
  return { playerId: `p-${name}`, name, order, msSinceOpen: order * 100 };
}

describe("GameMode round-trip (regression: silent downgrade to party)", () => {
  it("preserves buzzer mode through sessionStorage", () => {
    const payload = buildGamePayload({
      tracks: [],
      players: [{ name: "Wayn", score: 0 }],
      playlistName: "Party",
      clipDuration: 15,
      playlistSource: "own",
      mode: "buzzer",
      buzzerRoom: { code: "AB7K", hostToken: "secret-token", hostName: "Wayn" },
    });

    const parsed = parseGamePayload(JSON.stringify(payload));

    // Before isGameMode(), a ternary rewrote every mode it did not name to
    // "party" — a buzzer game silently became a party game on reload, with no
    // error anywhere.
    expect(parsed?.mode).toBe("buzzer");
    expect(parsed?.buzzerRoom).toEqual({ code: "AB7K", hostToken: "secret-token", hostName: "Wayn" });
  });

  it("still round-trips the pre-existing modes", () => {
    for (const mode of ["party"] as const) {
      const parsed = parseGamePayload(
        JSON.stringify(
          buildGamePayload({
            tracks: [],
            players: [],
            playlistName: "",
            clipDuration: 15,
            playlistSource: "own",
            mode,
          })
        )
      );
      expect(parsed?.mode).toBe(mode);
    }
  });

  it("falls back to party for a mode that is not in the union", () => {
    const parsed = parseGamePayload(
      JSON.stringify({ tracks: [], players: [], mode: "kahoot", playlistSource: "own" })
    );
    expect(parsed?.mode).toBe("party");
  });

  it("defaults a legacy room's host name instead of dropping a live game", () => {
    // Rooms created before hostName existed are still in someone's
    // sessionStorage; losing the whole handle would kick them out mid-party.
    const parsed = parseGamePayload(
      JSON.stringify({
        tracks: [],
        players: [],
        mode: "buzzer",
        buzzerRoom: { code: "AB7K", hostToken: "t" },
      })
    );
    expect(parsed?.buzzerRoom?.hostName).toBe("Host");
  });

  it("drops a buzzerRoom missing its host token rather than half-loading it", () => {
    const parsed = parseGamePayload(
      JSON.stringify({ tracks: [], players: [], mode: "buzzer", buzzerRoom: { code: "AB7K" } })
    );
    expect(parsed?.mode).toBe("buzzer");
    expect(parsed?.buzzerRoom).toBeUndefined();
  });
});

describe("buzzerJoinUrl", () => {
  it("points at the deployment the host is actually on, not the production domain", () => {
    // jsdom's origin, standing in for a Vercel preview host. Building this from
    // NEXT_PUBLIC_BASE_URL sent every scanned QR to www.guessong.app — a build
    // where the room, and on a feature branch the whole route, doesn't exist.
    process.env.NEXT_PUBLIC_BASE_URL = "https://www.guessong.app";
    expect(buzzerJoinUrl("ab7k")).toBe(`${window.location.origin}/buzz/AB7K`);
  });

  it("upper-cases the code so a lowercase scan still reaches the room", () => {
    expect(buzzerJoinUrl("ab7k")).toContain("/buzz/AB7K");
  });

  it("carries no host token", () => {
    expect(buzzerJoinUrl("AB7K")).not.toMatch(/token/i);
  });
});

describe("socketUrl (regression: Join Room crashed every phone older than 2024)", () => {
  const saved = process.env.NEXT_PUBLIC_BUZZER_WS_URL;
  afterEach(() => {
    // `= undefined` would leave the string "undefined" behind, which reads as
    // configured. Same idiom as tests/loop-links.test.ts.
    if (saved === undefined) delete process.env.NEXT_PUBLIC_BUZZER_WS_URL;
    else process.env.NEXT_PUBLIC_BUZZER_WS_URL = saved;
  });

  /**
   * What `new WebSocket(url)` did in every browser before Chrome 125, Firefox
   * 124 and Safari 17.3: refuse any scheme but ws/wss, at the constructor.
   * Newer engines fold http(s) into ws(s) themselves, which is exactly why a
   * developer's machine never sees this and a nine-year-old iPhone always does.
   */
  function legacyWebSocketAccepts(url: string): boolean {
    return /^wss?:\/\//.test(url);
  }

  it("folds an https:// Worker URL into wss:// — the value production was set to", () => {
    // README says wss://; the deployed bundle carried https://. Both name the
    // same Worker, and the join has to work on whichever the deploy used.
    process.env.NEXT_PUBLIC_BUZZER_WS_URL = "https://guesssong-buzzer.example.workers.dev";
    const url = socketUrl("ab7k");
    expect(url).toBe("wss://guesssong-buzzer.example.workers.dev/rooms/AB7K/ws");
    expect(legacyWebSocketAccepts(url!)).toBe(true);
  });

  it("folds http:// into ws:// for a local wrangler dev Worker", () => {
    process.env.NEXT_PUBLIC_BUZZER_WS_URL = "http://127.0.0.1:8787/";
    expect(socketUrl("ab7k")).toBe("ws://127.0.0.1:8787/rooms/AB7K/ws");
  });


  it("upgrades ws:// to wss:// when the page itself is https, because the constructor refuses mixed content", () => {
    // Chrome and Firefox throw SecurityError *synchronously* from
    // `new WebSocket("ws://…")` on an https page, inside the connect effect,
    // which is the crash screen again — reachable by pasting the Worker's URL
    // as http:// into the dashboard, the way wrangler prints a dev Worker.
    process.env.NEXT_PUBLIC_BUZZER_WS_URL = "http://guesssong-buzzer.example.workers.dev";
    vi.stubGlobal("location", { protocol: "https:" });
    try {
      expect(socketUrl("AB7K")).toBe("wss://guesssong-buzzer.example.workers.dev/rooms/AB7K/ws");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("leaves ws:// alone on an http page, where a dev Worker has no TLS to offer", () => {
    process.env.NEXT_PUBLIC_BUZZER_WS_URL = "http://localhost:8787";
    vi.stubGlobal("location", { protocol: "http:" });
    try {
      expect(socketUrl("AB7K")).toBe("ws://localhost:8787/rooms/AB7K/ws");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps retrying after the give-up instead of stopping, and resets everything per run", () => {
    // Pinned on the source: the hook is React and this suite cannot render
    // it. A `return` in the give-up branch ended the host's buzzer for the
    // party after a seven-second Wi-Fi blip; a reset that skipped the
    // snapshot showed the previous room's roster on a new one.
    const src = readFileSync(join(process.cwd(), "lib/use-buzzer-socket.ts"), "utf8");
    const giveUp = src.slice(src.indexOf("failedOpensRef.current >= MAX_FAILED_OPENS"), src.indexOf("reconnectTimer = setTimeout(connect"));
    expect(giveUp).toContain('code: "no_answer"');
    expect(giveUp).not.toMatch(/\breturn;/);
    expect(giveUp).toContain("delayRef.current = MAX_RECONNECT_MS");
    // The reset precedes the null-code guard, so leaving a room clears it.
    expect(src).toMatch(
      /failedOpensRef\.current = 0;[\s\S]*?delayRef\.current = INITIAL_RECONNECT_MS;[\s\S]*?\{ snapshot: null, isHost: false, connected: false, error: null \}[\s\S]*?if \(!code \|\| !playerId\) return;/
    );
  });

  it("wires reconnect() to the effect, and stops clearing the refusal on open", () => {
    // `attempt` is referenced nowhere inside the effect, so exhaustive-deps
    // would not notice it dropped from the dependency list — and the dead
    // end's only way out (Try again, Reconnect) would then do nothing.
    const src = readFileSync(join(process.cwd(), "lib/use-buzzer-socket.ts"), "utf8");
    expect(src).toMatch(/\}, \[code, playerId, attempt\]\);/);
    expect(src).toMatch(/const reconnect = useCallback\(\(\) => setAttempt\(\(n\) => n \+ 1\), \[\]\);/);
    // The open listener sets `connected` only: clearing the error there
    // flipped an evicted taker's screen to a live buzzer for the round trip
    // before its re-join was refused. The reducer's `state` case clears it.
    const openBlock = src.match(/addEventListener\("open", \(\) => \{[\s\S]*?\n      \}\);/)?.[0] ?? "";
    expect(openBlock).not.toBe("");
    expect(openBlock.replace(/\/\/.*$/gm, "")).not.toMatch(/error/);
  });

  it("renders every client code on the join page, each chair on its own surface, and Try again on no_answer", () => {
    const page = readFileSync(join(process.cwd(), "app/buzz/[code]/page.tsx"), "utf8");
    // A client code missing from the fatal list is a set error nobody
    // renders: the main view shows none, so the phone sits on "Connecting…".
    for (const code of Object.keys(BUZZER_CLIENT_ERROR_CODES)) {
      expect(page, code).toContain(`error.code === "${code}"`);
    }
    expect(page).toMatch(/buzzerErrorMessage\(error, locale, "player"\)/);
    expect(page).toMatch(/error\.code === "no_answer" && \([\s\S]*?onClick=\{reconnect\}/);
    for (const f of ["components/buzzer-host-panel.tsx", "components/room-panel.tsx"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src, f).toMatch(/buzzerErrorMessage\(\w+, locale, "host"\)/);
      expect(src, f).not.toMatch(/buzzerErrorMessage\([^)]*"player"\)/);
      expect(src, f).toMatch(/onClick=\{reconnect\}/);
    }
  });

  it("guards the constructor itself, so a URL the browser refuses is an error state and not a throw", () => {
    // The third synchronously-throwing browser call on the connect path,
    // after crypto.randomUUID and the storage access. Pinned on the source
    // because the hook is React and this suite cannot render it.
    const src = readFileSync(join(process.cwd(), "lib/use-buzzer-socket.ts"), "utf8");
    expect(src).toMatch(/try \{\s*\n\s*ws = new WebSocket\(url\);\s*\n\s*\} catch(?: \(\w+\))? \{/);
    expect(src).not.toMatch(/const ws = new WebSocket\(url\)/);
  });
  it("leaves a wss:// value alone, trailing slash included", () => {
    process.env.NEXT_PUBLIC_BUZZER_WS_URL = "wss://guesssong-buzzer.example.workers.dev/";
    expect(socketUrl("ab7k")).toBe("wss://guesssong-buzzer.example.workers.dev/rooms/AB7K/ws");
  });

  it("is null when the deployment has no Worker at all", () => {
    delete process.env.NEXT_PUBLIC_BUZZER_WS_URL;
    expect(socketUrl("AB7K")).toBeNull();
  });

  it("reads an empty value as unset, the same way the setup page does", () => {
    // A dashboard can save the variable with no value. `isBuzzerConfigured`
    // hides the toggle on `/` for that, but `/buzz/[code]` is reachable by URL
    // regardless, and a hook that disagreed would hand `new WebSocket()` the
    // bare path "/rooms/AB7K/ws" — a relative URL, a SyntaxError, the crash
    // screen. The two readings of the env var must stay the same reading.
    process.env.NEXT_PUBLIC_BUZZER_WS_URL = "";
    expect(socketUrl("AB7K")).toBeNull();
    expect(isBuzzerConfigured()).toBe(false);
  });

  it("trims the value, because a leading space defeats the scheme fold silently", () => {
    // Pasted into a dashboard with a stray space. Unfolded, the URL parser
    // strips the space and a new browser connects — the host's POST too — so
    // nothing on a developer's machine notices, while the old constructor
    // throws on it: the crash this module fixes, back from one character.
    process.env.NEXT_PUBLIC_BUZZER_WS_URL = " https://guesssong-buzzer.example.workers.dev \n";
    expect(socketUrl("ab7k")).toBe("wss://guesssong-buzzer.example.workers.dev/rooms/AB7K/ws");

    process.env.NEXT_PUBLIC_BUZZER_WS_URL = "   ";
    expect(socketUrl("AB7K")).toBeNull();
    expect(isBuzzerConfigured()).toBe(false);
  });

  it("leaves ws:// alone and folds only the leading scheme", () => {
    // ws:// is the documented local wrangler value and must not be touched —
    // the existing cases only ever fed the fold http(s) or wss. And the fold
    // matches a scheme, not the word: a hostname that carries "https" in it
    // reaches the constructor as typed.
    process.env.NEXT_PUBLIC_BUZZER_WS_URL = "ws://127.0.0.1:8787";
    expect(socketUrl("ab7k")).toBe("ws://127.0.0.1:8787/rooms/AB7K/ws");

    process.env.NEXT_PUBLIC_BUZZER_WS_URL = "wss://https-gateway.example.com";
    expect(socketUrl("ab7k")).toBe("wss://https-gateway.example.com/rooms/AB7K/ws");
  });

  it("accepts an upper-case scheme, which the URL parser lowercases before the constructor checks it", () => {
    // Pasted from a dashboard. The fold is case-insensitive on purpose; the
    // assertion goes through `new URL()` because that is what `new WebSocket()`
    // applies to the string before it looks at the scheme, in every engine —
    // so it stays true whether or not the fold ever normalises the case itself.
    process.env.NEXT_PUBLIC_BUZZER_WS_URL = "HTTPS://guesssong-buzzer.example.workers.dev";
    const secure = socketUrl("ab7k");
    expect(secure).toMatch(/^wss:\/\//i);
    expect(new URL(secure!).protocol).toBe("wss:");
    expect(new URL(secure!).pathname).toBe("/rooms/AB7K/ws");

    process.env.NEXT_PUBLIC_BUZZER_WS_URL = "Http://127.0.0.1:8787/";
    expect(new URL(socketUrl("ab7k")!).protocol).toBe("ws:");
  });

  it("URL-encodes the code so a segment that is not a code cannot rewrite the path", () => {
    // The code is the `/buzz/[code]` URL segment, which Next has already
    // decoded by the time the page sees it. A "/" or "?" inside it must reach
    // the Worker as one opaque segment, not as a second path element or a
    // query string on its router. The old line had this; the rewrite kept it.
    process.env.NEXT_PUBLIC_BUZZER_WS_URL = "https://guesssong-buzzer.example.workers.dev";
    expect(socketUrl("ab/7k")).toBe("wss://guesssong-buzzer.example.workers.dev/rooms/AB%2F7K/ws");
    expect(socketUrl("ab 7k")).toBe("wss://guesssong-buzzer.example.workers.dev/rooms/AB%207K/ws");
    expect(socketUrl("ab?7k#x")).toBe(
      "wss://guesssong-buzzer.example.workers.dev/rooms/AB%3F7K%23X/ws"
    );
  });

  it("keeps a path prefix under the origin and strips only the one trailing slash", () => {
    // The fold touches the scheme and nothing after it; the slash strip removes
    // the final "/" and never collapses the path. Pinned as a property of the
    // string, not of the deployment: worker/src/index.ts routes exactly /rooms
    // and /rooms/<code>/ws, so a prefixed Worker would need its routes changed
    // before this shape works end to end.
    process.env.NEXT_PUBLIC_BUZZER_WS_URL = "https://example.com/buzzer/";
    expect(socketUrl("ab7k")).toBe("wss://example.com/buzzer/rooms/AB7K/ws");

    process.env.NEXT_PUBLIC_BUZZER_WS_URL = "https://example.com/buzzer";
    expect(socketUrl("ab7k")).toBe("wss://example.com/buzzer/rooms/AB7K/ws");
  });

  it("derives the socket and the room POST from one value, whichever spelling the deploy used", async () => {
    // The docstring's claim: each side accepts either spelling, so the env var
    // is one value rather than two that can disagree. Pinned by driving both
    // consumers from the same value and checking they name the same Worker —
    // an https:// deploy (production's) and a wss:// deploy (the README's).
    const posted: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        posted.push(String(url));
        return { ok: true, status: 200, json: async () => ({ code: "AB7K", hostToken: "t" }) };
      })
    );
    try {
      // Secure spellings, either scheme, either case — and the insecure pair a
      // `wrangler dev` Worker is reached on, which is the one cell where the
      // fold must produce http:, not https:.
      const cases: Array<[base: string, post: string, socket: string]> = [
        ["https://guesssong-buzzer.example.workers.dev", "https:", "wss:"],
        ["wss://guesssong-buzzer.example.workers.dev", "https:", "wss:"],
        ["HTTPS://guesssong-buzzer.example.workers.dev", "https:", "wss:"],
        ["WSS://guesssong-buzzer.example.workers.dev", "https:", "wss:"],
        ["http://127.0.0.1:8787", "http:", "ws:"],
        ["ws://127.0.0.1:8787", "http:", "ws:"],
      ];
      for (const [base, postProtocol, socketProtocol] of cases) {
        process.env.NEXT_PUBLIC_BUZZER_WS_URL = base;
        posted.length = 0;
        await createBuzzerRoom();
        const post = new URL(posted[0]);
        const socket = new URL(socketUrl("AB7K")!);
        expect(post.protocol).toBe(postProtocol);
        expect(socket.protocol).toBe(socketProtocol);
        expect(socket.host).toBe(post.host);
        expect(post.pathname).toBe("/rooms");
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("getPersistentPlayerId (regression: Buzzer Mode crashed every phone older than 2022)", () => {
  const PLAYER_ID_KEY = "guesssong_player_id";
  /** An id a device already holds, in the shape every id ever minted has. */
  const DEVICE_ID = "11111111-2222-4333-8444-555555555555";
  // RFC 4122 v4: the version nibble is 4 and the variant nibble is 8–b. The
  // Worker is handed this string as the identity it dedupes on, and the
  // protocol documents it as a UUID, so the fallback has to be one too.
  const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  const realCrypto = globalThis.crypto;

  /** Safari/iOS before 15.4, Chrome before 92: `getRandomValues` but no `randomUUID`. */
  function installLegacyCrypto(): void {
    vi.stubGlobal("crypto", {
      getRandomValues: (a: Uint8Array) => realCrypto.getRandomValues(a),
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // Module state, or every test after the first minter would be asserting
    // against the id that test left behind — the headline regression test
    // reached `mintPlayerId` only because it happened to run first.
    __resetPlayerIdForTests();
    uninstallStorage();
  });

  it("really has storage, so the persistence assertions below are not vacuous", () => {
    installStorage();
    window.localStorage.setItem("canary", "1");
    expect(window.localStorage.getItem("canary")).toBe("1");
  });

  it("mints a v4 UUID through crypto.randomUUID where the browser has it", () => {
    expect(typeof crypto.randomUUID).toBe("function");
    expect(mintPlayerId()).toMatch(V4);
  });

  it("mints a v4 UUID without crypto.randomUUID — the call that threw on every pre-2022 phone", () => {
    installLegacyCrypto();
    expect(typeof crypto.randomUUID).toBe("undefined");
    const id = mintPlayerId();
    expect(id).toMatch(V4);
    expect(mintPlayerId()).not.toBe(id);
  });

  it("still mints a v4-shaped id with no crypto at all", () => {
    vi.stubGlobal("crypto", undefined);
    expect(typeof crypto).toBe("undefined");
    const id = mintPlayerId();
    expect(id).toMatch(V4);
    expect(mintPlayerId()).not.toBe(id);
  });

  it("does not throw on a legacy browser, and persists what it minted", () => {
    // This is the reported bug: `useMemo(() => getPersistentPlayerId(), [])`
    // runs during render, so the TypeError landed in app/error.tsx and the
    // host read "The game stopped" the moment Buzzer Mode was switched on.
    installLegacyCrypto();
    const map = installStorage();
    map.delete(PLAYER_ID_KEY);
    let id = "";
    expect(() => {
      id = getPersistentPlayerId();
    }).not.toThrow();
    expect(id).toMatch(V4);
    expect(map.get(PLAYER_ID_KEY)).toBe(id);
    expect(getPersistentPlayerId()).toBe(id);
  });

  it("returns the id already on the device rather than minting over it", () => {
    // Reconnect-into-the-same-seat depends on this: a new id is a new player.
    const map = installStorage();
    map.set(PLAYER_ID_KEY, DEVICE_ID);
    expect(getPersistentPlayerId()).toBe(DEVICE_ID);
  });

  it("degrades to a per-page id when the browser refuses storage, instead of throwing", () => {
    // The same SecurityError lib/game-storage.ts and lib/host-session.ts guard
    // against; the seat does not survive a reload on such a device, and the
    // game still plays.
    installThrowingStorage();
    let id = "";
    expect(() => {
      id = getPersistentPlayerId();
    }).not.toThrow();
    expect(id).toMatch(V4);
    // Stable for the life of the page: the setup page's room panel and the
    // game page's host panel must present one identity to the room.
    expect(getPersistentPlayerId()).toBe(id);
  });

  it("keeps the v4 version and variant bits across 200 draws without crypto.randomUUID", () => {
    installLegacyCrypto();
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = mintPlayerId();
      expect(id).toMatch(V4);
      ids.add(id);
    }
    // 122 bits of entropy: a repeat is a bug in the draw, not bad luck.
    expect(ids.size).toBe(200);
  });

  it("keeps the v4 version and variant bits across 200 draws with no crypto at all", () => {
    vi.stubGlobal("crypto", undefined);
    const random = vi.spyOn(Math, "random");
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = mintPlayerId();
      expect(id).toMatch(V4);
      ids.add(id);
    }
    expect(ids.size).toBe(200);
    // The tier it says it is: sixteen bytes per id, every one drawn here.
    expect(random.mock.calls.length).toBeGreaterThanOrEqual(200 * 16);
  });

  it("forces the version and variant nibbles and zero-pads every byte", () => {
    // All-ones and all-zeros bytes are the two draws that expose a missing
    // mask (0xff would read as version f, variant f) and a missing padStart
    // (0x00 would print as "0", shortening the id by a character each).
    const fill = (byte: number) =>
      vi.stubGlobal("crypto", {
        getRandomValues: (a: Uint8Array) => {
          a.fill(byte);
          return a;
        },
      });
    fill(0xff);
    expect(mintPlayerId()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    fill(0x00);
    expect(mintPlayerId()).toBe("00000000-0000-4000-8000-000000000000");
  });

  it("draws from Math.random when crypto exists but offers neither function", () => {
    // A `crypto` object with no `getRandomValues` is the third shape the
    // guard distinguishes; without the typeof check it would be a TypeError
    // one line later than the one this fix removed.
    vi.stubGlobal("crypto", {});
    const random = vi.spyOn(Math, "random");
    const id = mintPlayerId();
    expect(id).toMatch(V4);
    expect(random).toHaveBeenCalledTimes(16);
  });

  // ---- getPersistentPlayerId's remaining branches ----

  it("returns an empty id on the server, touching neither crypto nor storage", () => {
    // `useMemo(() => getPersistentPlayerId(), [])` runs during the server
    // render of the join page too; an SSR pass must not mint an id the
    // browser will never see, and must not throw for want of `window`.
    vi.stubGlobal("window", undefined);
    expect(typeof window).toBe("undefined");
    let id = "not-set";
    expect(() => {
      id = getPersistentPlayerId();
    }).not.toThrow();
    expect(id).toBe("");
  });

  it("keeps one identity across the page when only the write is refused", () => {
    // The room panel on `/` and the host panel on `/game` each call this;
    // with the write refused every call would otherwise mint a new player.
    const map = installQuotaStorage();
    map.delete(PLAYER_ID_KEY);
    const first = getPersistentPlayerId();
    expect(first).toMatch(V4);
    expect(getPersistentPlayerId()).toBe(first);
    expect(map.has(PLAYER_ID_KEY)).toBe(false);
  });

  it("writes the page-scoped id through once storage is back, rather than minting again", () => {
    // Minted while storage was refusing; the next call with storage working
    // must persist that same id, not a second one — one seat, now durable.
    installThrowingStorage();
    const pageId = getPersistentPlayerId();
    expect(pageId).toMatch(V4);
    const map = installStorage();
    map.delete(PLAYER_ID_KEY);
    expect(getPersistentPlayerId()).toBe(pageId);
    expect(map.get(PLAYER_ID_KEY)).toBe(pageId);
  });

  it("lets the id already on the device outrank the page-scoped one", () => {
    // The device's id is what every earlier room knows this player as; a
    // page-scoped id is only ever a stand-in for a device that would not
    // keep one.
    installThrowingStorage();
    const pageId = getPersistentPlayerId();
    expect(pageId).toMatch(V4);
    const map = installStorage();
    map.set(PLAYER_ID_KEY, DEVICE_ID);
    expect(getPersistentPlayerId()).toBe(DEVICE_ID);
    expect(getPersistentPlayerId()).not.toBe(pageId);
  });

  it("keeps presenting the device's id after storage stops answering", () => {
    // The read succeeds on `/` and is refused on `/game` — quota, a private-
    // mode transition. Without the memo on the hit branch the second call
    // minted a fresh player, and the room saw the host leave and a stranger
    // arrive. The memo is "the last id this page presented", on every branch.
    const map = installStorage();
    map.set(PLAYER_ID_KEY, DEVICE_ID);
    expect(getPersistentPlayerId()).toBe(DEVICE_ID);
    installThrowingStorage();
    expect(getPersistentPlayerId()).toBe(DEVICE_ID);
  });

  it("mints over a stored value that is not an id, rather than handing it to the room", () => {
    // The Worker persists a hash under whatever it is sent and only checks
    // that it is truthy; a corrupted or hand-edited key would ride through.
    for (const junk of ["", "not-a-uuid", "11111111-2222-3333-4444-555555555555", "x".repeat(4096)]) {
      __resetPlayerIdForTests();
      const map = installStorage();
      map.set(PLAYER_ID_KEY, junk);
      const id = getPersistentPlayerId();
      expect(id).toMatch(V4);
      expect(id).not.toBe(junk);
      expect(map.get(PLAYER_ID_KEY)).toBe(id);
    }
  });

  it("accepts an upper-case stored id, which is still the shape it minted", () => {
    const map = installStorage();
    map.set(PLAYER_ID_KEY, DEVICE_ID.toUpperCase());
    expect(getPersistentPlayerId()).toBe(DEVICE_ID.toUpperCase());
  });
});

describe("localStorage is only ever touched through withStorage", () => {
  // The three files this branch fixed each read `window.localStorage` bare,
  // and a locked-down browser throws on that property access itself — in a
  // mount effect or a `useMemo` that is app/error.tsx in place of the page.
  // The call sites live in .tsx, which this suite cannot import (see
  // tests/mobile.test.ts for the same constraint), so the rule is pinned on
  // the source: across app/, components/ and lib/ the only access is the one
  // inside `withStorage`'s try. A new bare access anywhere fails here with
  // its file and line, not in a user's email.
  const ROOTS = ["app", "components", "lib"];
  const GUARD = "lib/host-session.ts";
  // The three files this branch fixed. If the walk ever stops reaching them
  // — `recursive` is silently ignored by a Node older than 20.1 and the scan
  // then reads three top-level directories and nothing under them — the rule
  // passes having checked nothing; this is its canary.
  const MUST_REACH = ["lib/use-buzzer-socket.ts", "components/room-panel.tsx", "app/buzz/[code]/page.tsx"];

  function sourceFiles(root: string): string[] {
    return readdirSync(join(process.cwd(), root), { recursive: true, encoding: "utf8" })
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => [root, ...f.split(sep)].join("/"));
  }

  /**
   * An access, not a mention: `window.localStorage`, `localStorage.getItem`,
   * `globalThis.localStorage`. A trailing `// …localStorage…` on a code line
   * is prose and is dropped before matching, as is a line that is itself a
   * comment. One predicate for both tests, so they cannot drift apart.
   */
  function accessesStorage(line: string): boolean {
    if (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line)) return false;
    // The bracket spelling is checked before literals are blanked, being one.
    if (/\[\s*["']localStorage["']\s*\]/.test(line)) return true;
    // String literals first, so the `//` inside a URL is not read as a
    // comment that hides an access after it; then the trailing comment.
    const code = line
      .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""')
      .replace(/\/\/.*$/, "");
    return /\.localStorage\b|\blocalStorage\s*\.|\{\s*localStorage\s*\}/.test(code);
  }

  it("actually reaches the nested files it claims to scan", () => {
    expect(ROOTS.flatMap(sourceFiles)).toEqual(expect.arrayContaining(MUST_REACH));
  });

  it("has no bare window.localStorage access outside lib/host-session.ts", () => {
    const bare: string[] = [];
    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        if (file === GUARD) continue;
        readFileSync(join(process.cwd(), file), "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (accessesStorage(line)) bare.push(`${file}:${i + 1}`);
          });
      }
    }
    expect(bare, `bare localStorage access: ${bare.join(", ")}`).toEqual([]);
  });

  it("keeps the one real access inside withStorage's try", () => {
    const guard = readFileSync(join(process.cwd(), GUARD), "utf8");
    const accesses = guard.split("\n").filter(accessesStorage);
    expect(accesses).toHaveLength(1);
    expect(guard).toMatch(/try \{\s*\n\s*return fn\(window\.localStorage\);/);
  });

  it("reads an access and not a mention, so a trailing comment cannot fail the rule", () => {
    expect(accessesStorage("const saved = withStorage((s) => s.getItem(K), null); // was localStorage")).toBe(false);
    expect(accessesStorage("   * jsdom gives window but not localStorage")).toBe(false);
    expect(accessesStorage("      {/* localStorage is guarded */}")).toBe(false);
    expect(accessesStorage('const label = "localStorage"; // a string, not an access')).toBe(false);
    expect(accessesStorage("const saved = window.localStorage.getItem(K);")).toBe(true);
    expect(accessesStorage("  localStorage.setItem(K, v);")).toBe(true);
    expect(accessesStorage("return fn(globalThis.localStorage);")).toBe(true);
  });

  it("is not blinded by a URL on the same line, nor by the bracket and destructuring spellings", () => {
    expect(accessesStorage('<a href="https://x.y" onClick={() => window.localStorage.removeItem(K)}>')).toBe(true);
    expect(accessesStorage('const u = "https://a"; window.localStorage.setItem(K, v);')).toBe(true);
    expect(accessesStorage('window["localStorage"].getItem(K)')).toBe(true);
    expect(accessesStorage("const { localStorage } = window;")).toBe(true);
  });
});

describe("parseClientMessage", () => {
  it("accepts every message the protocol defines", () => {
    const types = [
      "join",
      "buzz",
      "host:open",
      "host:verdict",
      "host:reveal",
      "host:next",
      "ping",
    ];
    for (const type of types) {
      expect(parseClientMessage(JSON.stringify({ type }))).not.toBeNull();
    }
  });

  it("rejects malformed, unknown, and non-object frames", () => {
    expect(parseClientMessage("not json")).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "host:nuke" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ noType: true }))).toBeNull();
    expect(parseClientMessage(JSON.stringify(null))).toBeNull();
    expect(parseClientMessage(JSON.stringify("string"))).toBeNull();
    expect(parseClientMessage(JSON.stringify(42))).toBeNull();
  });
});

describe("client reducer", () => {
  it("adopts the server snapshot wholesale on join", () => {
    const next = reduce(emptyState, {
      type: "state",
      snapshot: snapshot({ phase: "locked", roundIndex: 3 }),
      you: { playerId: "p-1", isHost: true },
    });
    expect(next.snapshot?.phase).toBe("locked");
    expect(next.snapshot?.roundIndex).toBe(3);
    expect(next.isHost).toBe(true);
  });

  it("clears buzzes when a round opens", () => {
    const withBuzz = reduce(
      { ...emptyState, snapshot: snapshot({ phase: "locked", buzzes: [entry("Ann", 1)] }) },
      { type: "round:open", roundIndex: 1, openedAt: 500 }
    );
    expect(withBuzz.snapshot?.phase).toBe("open");
    expect(withBuzz.snapshot?.buzzes).toEqual([]);
    expect(withBuzz.snapshot?.roundOpenedAt).toBe(500);
  });

  it("appends buzzes in arrival order", () => {
    let s: BuzzerSocketState = { ...emptyState, snapshot: snapshot({ phase: "open" }) };
    s = reduce(s, { type: "buzz", entry: entry("Ann", 1), phase: "locked" });
    s = reduce(s, { type: "buzz", entry: entry("Bob", 2), phase: "locked" });
    expect(s.snapshot?.buzzes.map((b) => b.name)).toEqual(["Ann", "Bob"]);
    expect(s.snapshot?.phase).toBe("locked");
  });

  it("ignores a replayed buzz for a player already in the queue", () => {
    // A phone that reconnects mid-round gets the queue replayed; without the
    // dedupe the same person would appear twice and the displayed order would
    // stop matching the room's.
    let s: BuzzerSocketState = { ...emptyState, snapshot: snapshot({ phase: "open" }) };
    s = reduce(s, { type: "buzz", entry: entry("Ann", 1), phase: "locked" });
    s = reduce(s, { type: "buzz", entry: entry("Ann", 1), phase: "locked" });
    expect(s.snapshot?.buzzes).toHaveLength(1);
  });


  it("returns to idle when the round resolves", () => {
    const s = reduce(
      { ...emptyState, snapshot: snapshot({ phase: "locked", roundOpenedAt: 100 }) },
      { type: "round:resolved", roundIndex: 0, verdict: "correct" }
    );
    expect(s.snapshot?.phase).toBe("idle");
    expect(s.snapshot?.roundOpenedAt).toBeNull();
  });

  it("survives messages that arrive before the first snapshot", () => {
    // The socket can deliver a broadcast between `open` and our `join` reply.
    // Dropping those is correct: the snapshot that follows is authoritative.
    const earlyMessages: ServerMessage[] = [
      { type: "round:open", roundIndex: 1, openedAt: 1 },
      { type: "buzz", entry: entry("Ann", 1), phase: "locked" },
      { type: "players", players: [] },
    ];
    for (const msg of earlyMessages) {
      expect(() => reduce(emptyState, msg)).not.toThrow();
      expect(reduce(emptyState, msg).snapshot).toBeNull();
    }
  });
});

describe("mergeRoomRoster (regression: buzzer winners scored nothing)", () => {
  // The bug this exists to stop: the scoreboard came from names typed at setup
  // while the buzzers came from names typed on each phone. awardPoint matches by
  // name, so tapping "Correct" for a player who only existed in the room mapped
  // over nothing and silently awarded zero. Reproduced in a browser: PhonePlayer
  // buzzed, host tapped Correct, scoreboard stayed at 0.
  it("adds room players the scoreboard has never seen", () => {
    const merged = mergeRoomRoster([], ["Amy", "Ken"]);
    expect(merged).toEqual([
      { name: "Amy", score: 0 },
      { name: "Ken", score: 0 },
    ]);
  });

  it("keeps existing scores when the roster is re-sent", () => {
    const players = [{ name: "Amy", score: 6 }];
    expect(mergeRoomRoster(players, ["Amy", "Ken"])).toEqual([
      { name: "Amy", score: 6 },
      { name: "Ken", score: 0 },
    ]);
  });

  it("returns the same array when nothing is new, so a snapshot loop can't thrash", () => {
    // setPlayers(prev => merge(prev, names)) runs on every room broadcast. A
    // fresh array each time would re-render the whole game page per heartbeat.
    const players = [{ name: "Amy", score: 3 }];
    expect(mergeRoomRoster(players, ["Amy"])).toBe(players);
  });

  it("treats a differently-cased name as the same player", () => {
    // The room refuses a second "amy" while "Amy" is connected, so two spellings
    // are one human reconnecting. Two rows would split their score.
    const players = [{ name: "Amy", score: 3 }];
    expect(mergeRoomRoster(players, ["amy"])).toBe(players);
  });

  it("never drops a player who left, so a locked phone doesn't wipe a score", () => {
    const players = [{ name: "Amy", score: 9 }];
    expect(mergeRoomRoster(players, ["Ken"])).toEqual([
      { name: "Amy", score: 9 },
      { name: "Ken", score: 0 },
    ]);
  });

  it("ignores blank names and dedupes within one roster", () => {
    expect(mergeRoomRoster([], ["  ", "Amy", "amy", ""])).toEqual([{ name: "Amy", score: 0 }]);
  });
});

describe("queue advance on a wrong answer", () => {
  // The room shifts its queue and broadcasts the NEW head as a `buzz` frame.
  // That frame carries a player the client already has, which the reducer used
  // to discard as a reconnect replay — so the host tapped "Wrong", the room
  // moved on, and their screen kept the eliminated player at the head.
  it("drops the eliminated player when the room advances to someone queued", () => {
    let s: BuzzerSocketState = { ...emptyState, snapshot: snapshot({ phase: "open" }) };
    s = reduce(s, { type: "buzz", entry: entry("Ann", 1), phase: "locked" });
    s = reduce(s, { type: "buzz", entry: entry("Bob", 2), phase: "locked" });
    s = reduce(s, { type: "buzz", entry: entry("Cat", 3), phase: "locked" });

    // Host says Ann was wrong; the room promotes Bob.
    s = reduce(s, { type: "buzz", entry: entry("Bob", 2), phase: "locked" });

    expect(s.snapshot?.buzzes.map((b) => b.name)).toEqual(["Bob", "Cat"]);
  });

  it("still ignores a replay of the player already at the head", () => {
    let s: BuzzerSocketState = { ...emptyState, snapshot: snapshot({ phase: "open" }) };
    s = reduce(s, { type: "buzz", entry: entry("Ann", 1), phase: "locked" });
    s = reduce(s, { type: "buzz", entry: entry("Bob", 2), phase: "locked" });
    s = reduce(s, { type: "buzz", entry: entry("Ann", 1), phase: "locked" });
    expect(s.snapshot?.buzzes.map((b) => b.name)).toEqual(["Ann", "Bob"]);
  });

  it("clears a refusal on the room's state frame and on nothing else", () => {
    // With `open` no longer clearing the error, this is the one place a
    // refusal is lifted inside an effect run; the host panels render the
    // error in place of the connected count for as long as it is set.
    const refused: BuzzerSocketState = { ...emptyState, error: { code: "name_taken", message: "" } };
    const joined = reduce(refused, { type: "state", snapshot: snapshot(), you: { playerId: "p-1", isHost: false } });
    expect(joined.error).toBeNull();
    expect(reduce(refused, { type: "players", players: [] }).error).toEqual(refused.error);
    expect(reduce(refused, { type: "round:open", roundIndex: 0, openedAt: 1 }).error).toEqual(refused.error);
  });

  it("appends a new buzz whose order collides with one already queued", () => {
    // The room numbers a buzz by the queue's length and does not renumber
    // after a wrong verdict shifts the queue, so after [Ann#1, Bob#2] → Wrong
    // → [Bob#2] the next buzzer is #2 as well. Matching on `order` here once
    // swallowed that buzz; the id is the only key.
    const s = reduce(
      { ...emptyState, snapshot: snapshot({ phase: "locked", buzzes: [entry("Bob", 2)] }) },
      { type: "buzz", entry: entry("Cat", 2), phase: "locked" }
    );
    expect(s.snapshot?.buzzes.map((b) => b.name)).toEqual(["Bob", "Cat"]);
  });

  it("keeps the queue when the round resolves, because scoring happens after reveal", () => {
    // The host reveals the answer and only then awards the point, so the queue
    // has to survive `round:resolved` — it is what the scoring UI reads to offer
    // "Ann buzzed first, +3" instead of the full player list. The server agrees:
    // handleResolve leaves room.buzzes alone and host:next is what clears it.
    const s = reduce(
      { ...emptyState, snapshot: snapshot({ phase: "locked", buzzes: [entry("Ann", 1)] }) },
      { type: "round:resolved", roundIndex: 0, verdict: "correct" }
    );
    expect(s.snapshot?.phase).toBe("idle");
    expect(s.snapshot?.buzzes.map((b) => b.name)).toEqual(["Ann"]);
  });
});
