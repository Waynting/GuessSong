import { SELF } from "cloudflare:test";
import { describe, it, expect, afterEach } from "vitest";
import type { ClientMessage, ServerMessage } from "../../lib/buzzer-protocol";

const ORIGIN = "https://www.guessong.app";

/**
 * Sockets opened by the current test. Left open, they keep their Durable Object
 * alive past teardown and the pool's storage bookkeeping trips over it.
 */
const openSockets: WebSocket[] = [];

afterEach(() => {
  for (const ws of openSockets.splice(0)) {
    try {
      ws.close();
    } catch {
      /* already gone */
    }
  }
});

async function createRoom(): Promise<{ code: string; hostToken: string }> {
  const res = await SELF.fetch("https://buzzer.test/rooms", {
    method: "POST",
    headers: { Origin: ORIGIN },
  });
  expect(res.status).toBe(200);
  return res.json();
}

/** Opens a real WebSocket to the room and buffers every server frame. */
async function connect(code: string) {
  const res = await SELF.fetch(`https://buzzer.test/rooms/${code}/ws`, {
    headers: { Upgrade: "websocket", Origin: ORIGIN },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  if (!ws) throw new Error("no webSocket on 101 response");
  ws.accept();
  openSockets.push(ws);

  const received: ServerMessage[] = [];
  ws.addEventListener("message", (e) => {
    received.push(JSON.parse(String(e.data)) as ServerMessage);
  });

  return {
    ws,
    received,
    send(msg: ClientMessage) {
      ws.send(JSON.stringify(msg));
    },
    /** Resolves once `predicate` is satisfied, or throws after `timeoutMs`. */
    async waitFor<T extends ServerMessage>(
      predicate: (m: ServerMessage) => m is T,
      timeoutMs = 2000
    ): Promise<T> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const hit = received.find(predicate);
        if (hit) return hit;
        if (Date.now() > deadline) {
          throw new Error(`timed out; got: ${received.map((m) => m.type).join(", ")}`);
        }
        await scheduler.wait(10);
      }
    },
  };
}

const isState = (m: ServerMessage): m is Extract<ServerMessage, { type: "state" }> =>
  m.type === "state";
const isBuzz = (m: ServerMessage): m is Extract<ServerMessage, { type: "buzz" }> =>
  m.type === "buzz";
const isError = (m: ServerMessage): m is Extract<ServerMessage, { type: "error" }> =>
  m.type === "error";

async function joinedHost(code: string, hostToken: string) {
  const c = await connect(code);
  c.send({ type: "join", playerId: "host-1", name: "Host", hostToken });
  await c.waitFor(isState);
  return c;
}

async function joinedPlayer(code: string, id: string, name: string) {
  const c = await connect(code);
  c.send({ type: "join", playerId: id, name });
  await c.waitFor(isState);
  return c;
}

describe("room lifecycle", () => {
  it("mints a code and host token, and refuses unknown codes", async () => {
    const { code, hostToken } = await createRoom();
    expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
    expect(hostToken).toBeTruthy();

    const res = await SELF.fetch("https://buzzer.test/rooms/ZZZZ/ws", {
      headers: { Upgrade: "websocket", Origin: ORIGIN },
    });
    // Probing the code space must not open a socket, or enumeration becomes
    // free and every guess holds a connection.
    expect(res.status).toBe(404);
  });

  it("refuses connections from an origin that is not allow-listed", async () => {
    const { code } = await createRoom();
    const res = await SELF.fetch(`https://buzzer.test/rooms/${code}/ws`, {
      headers: { Upgrade: "websocket", Origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("routes a lowercase code to the same room", async () => {
    const { code, hostToken } = await createRoom();
    await joinedHost(code, hostToken);
    const lower = await connect(code.toLowerCase());
    lower.send({ type: "join", playerId: "p-1", name: "Ann" });
    const state = await lower.waitFor(isState);
    // Same object, so the host is already in the player list.
    expect(state.snapshot.players.map((p) => p.name)).toContain("Host");
  });
});

describe("buzz arbitration", () => {
  it("gives exactly one winner when several phones buzz together", async () => {
    const { code, hostToken } = await createRoom();
    const host = await joinedHost(code, hostToken);
    const players = await Promise.all([
      joinedPlayer(code, "p-1", "Ann"),
      joinedPlayer(code, "p-2", "Bob"),
      joinedPlayer(code, "p-3", "Cai"),
      joinedPlayer(code, "p-4", "Dee"),
    ]);

    host.send({ type: "host:open", hostToken });
    await Promise.all(players.map((p) => p.waitFor((m) => m.type === "round:open")));

    // Fire every buzz in one tick with no await between them. This is the
    // closest a test can get to four thumbs landing at once.
    for (const p of players) p.send({ type: "buzz", roundIndex: 0 });

    await host.waitFor((m): m is Extract<ServerMessage, { type: "buzz" }> => {
      return m.type === "buzz" && m.entry.order === players.length;
    });

    const buzzes = host.received.filter(isBuzz).map((m) => m.entry);
    const orders = buzzes.map((b) => b.order);
    const ids = buzzes.map((b) => b.playerId);

    expect(orders).toEqual([1, 2, 3, 4]);
    expect(new Set(ids).size).toBe(4);
    expect(orders.filter((o) => o === 1)).toHaveLength(1);
    // First buzz locks the round; everyone after queues behind them.
    expect(host.received.filter(isBuzz)[0].phase).toBe("locked");
  });

  it("ignores a second buzz from the same player in one round", async () => {
    const { code, hostToken } = await createRoom();
    const host = await joinedHost(code, hostToken);
    const ann = await joinedPlayer(code, "p-1", "Ann");

    host.send({ type: "host:open", hostToken });
    await ann.waitFor((m) => m.type === "round:open");

    ann.send({ type: "buzz", roundIndex: 0 });
    ann.send({ type: "buzz", roundIndex: 0 });
    ann.send({ type: "buzz", roundIndex: 0 });
    await host.waitFor(isBuzz);
    await scheduler.wait(100);

    // Mobile long-press fires repeatedly; the room is the second line of
    // defence behind the client's own pressed-state guard.
    expect(host.received.filter(isBuzz)).toHaveLength(1);
  });

  it("drops a buzz aimed at a round that already moved on", async () => {
    const { code, hostToken } = await createRoom();
    const host = await joinedHost(code, hostToken);
    const ann = await joinedPlayer(code, "p-1", "Ann");

    host.send({ type: "host:open", hostToken });
    await ann.waitFor((m) => m.type === "round:open");
    host.send({ type: "host:reveal", hostToken });
    host.send({ type: "host:next", hostToken });
    await scheduler.wait(50);

    // A phone that was mid-press when the host advanced must not score on the
    // new song.
    ann.send({ type: "buzz", roundIndex: 0 });
    await scheduler.wait(100);
    expect(host.received.filter(isBuzz)).toHaveLength(0);
  });


  it("advances the queue on a wrong answer and reopens when it empties", async () => {
    const { code, hostToken } = await createRoom();
    const host = await joinedHost(code, hostToken);
    const ann = await joinedPlayer(code, "p-1", "Ann");
    const bob = await joinedPlayer(code, "p-2", "Bob");

    host.send({ type: "host:open", hostToken });
    await bob.waitFor((m) => m.type === "round:open");
    ann.send({ type: "buzz", roundIndex: 0 });
    await host.waitFor(isBuzz);
    bob.send({ type: "buzz", roundIndex: 0 });
    await host.waitFor((m): m is Extract<ServerMessage, { type: "buzz" }> =>
      m.type === "buzz" && m.entry.name === "Bob"
    );

    host.send({ type: "host:verdict", hostToken, verdict: "wrong" });
    // Ann was wrong, so Bob is now on the spot and the round stays locked.
    const promoted = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "buzz" }> =>
        m.type === "buzz" && m.entry.name === "Bob" && m.phase === "locked"
    );
    expect(promoted.entry.name).toBe("Bob");

    host.send({ type: "host:verdict", hostToken, verdict: "wrong" });
    // Queue is empty now, so everyone gets another shot rather than the round
    // dead-ending with nobody able to answer.
    const reopened = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "round:open" }> => m.type === "round:open"
    );
    expect(reopened).toBeTruthy();
  });
});

describe("host authority", () => {
  it("rejects host actions without the token", async () => {
    const { code, hostToken } = await createRoom();
    await joinedHost(code, hostToken);
    const ann = await joinedPlayer(code, "p-1", "Ann");

    ann.send({ type: "host:open", hostToken: "guessed-token" });
    const err = await ann.waitFor(isError);
    expect(err.code).toBe("not_host");
  });

  it("requires join before anything else", async () => {
    const { code } = await createRoom();
    const c = await connect(code);
    c.send({ type: "buzz", roundIndex: 0 });
    const err = await c.waitFor(isError);
    expect(err.code).toBe("not_joined");
  });

  it("rejects a duplicate name from a different device", async () => {
    const { code, hostToken } = await createRoom();
    await joinedHost(code, hostToken);
    await joinedPlayer(code, "p-1", "Ann");

    const impostor = await connect(code);
    impostor.send({ type: "join", playerId: "p-2", name: "ann" });
    const err = await impostor.waitFor(isError);
    expect(err.code).toBe("name_taken");
  });
});

describe("reconnect", () => {
  it("replays full round state to a phone that comes back mid-round", async () => {
    const { code, hostToken } = await createRoom();
    const host = await joinedHost(code, hostToken);
    const ann = await joinedPlayer(code, "p-1", "Ann");

    host.send({ type: "host:open", hostToken });
    await ann.waitFor((m) => m.type === "round:open");
    ann.send({ type: "buzz", roundIndex: 0 });
    await host.waitFor(isBuzz);

    // Ann's phone locks and drops. Same playerId comes back on a new socket.
    ann.ws.close();
    await scheduler.wait(50);
    const back = await connect(code);
    back.send({ type: "join", playerId: "p-1", name: "Ann" });
    const state = await back.waitFor(isState);

    expect(state.snapshot.phase).toBe("locked");
    expect(state.snapshot.buzzes.map((b) => b.name)).toEqual(["Ann"]);
    expect(state.you.playerId).toBe("p-1");
    // Identity is the playerId, not the socket, so she is not a second player.
    expect(state.snapshot.players.filter((p) => p.name === "Ann")).toHaveLength(1);
  });

  it("restores host powers on reconnect when the token is presented again", async () => {
    const { code, hostToken } = await createRoom();
    const host = await joinedHost(code, hostToken);
    host.ws.close();
    await scheduler.wait(50);

    const back = await connect(code);
    back.send({ type: "join", playerId: "host-1", name: "Host", hostToken });
    const state = await back.waitFor(isState);
    expect(state.you.isHost).toBe(true);

    back.send({ type: "host:open", hostToken });
    await back.waitFor((m) => m.type === "round:open");
  });
});
