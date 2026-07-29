import { describe, it, expect } from "vitest";
import { buildGamePayload, parseGamePayload, mergeRoomRoster } from "@/lib/game-session";
import { reduce, type BuzzerSocketState } from "@/lib/use-buzzer-socket";
import { buzzerJoinUrl } from "@/lib/buzzer-client";
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

    // Before isGameMode(), the ternary at the old line 125 rewrote anything
    // that wasn't "trial" to "party" — a buzzer game silently became a party
    // game on reload, with no error anywhere.
    expect(parsed?.mode).toBe("buzzer");
    expect(parsed?.buzzerRoom).toEqual({ code: "AB7K", hostToken: "secret-token", hostName: "Wayn" });
  });

  it("still round-trips the pre-existing modes", () => {
    for (const mode of ["party", "trial"] as const) {
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
