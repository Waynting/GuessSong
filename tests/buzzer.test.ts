import { describe, it, expect, afterEach, vi } from "vitest";
import { buildGamePayload, parseGamePayload, mergeRoomRoster } from "@/lib/game-session";
import { reduce, socketUrl, type BuzzerSocketState } from "@/lib/use-buzzer-socket";
import { buzzerJoinUrl, createBuzzerRoom, isBuzzerConfigured } from "@/lib/buzzer-client";
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
