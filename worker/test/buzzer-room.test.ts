import { SELF, env, runInDurableObject } from "cloudflare:test";
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

/**
 * A fresh client IP per call, because the Worker's rate limiter buckets by
 * CF-Connecting-IP and a real run of this file opens far more rooms than one
 * host ever would. Sharing an IP across the suite means test #6 fails on the
 * create budget rather than on anything it was written to check.
 */
let nextIp = 0;
function clientIp(): string {
  nextIp += 1;
  return `203.0.113.${nextIp % 256}`;
}

async function createRoom(ip = clientIp()): Promise<{ code: string; hostToken: string }> {
  const res = await SELF.fetch("https://buzzer.test/rooms", {
    method: "POST",
    headers: { Origin: ORIGIN, "CF-Connecting-IP": ip },
  });
  expect(res.status).toBe(200);
  return res.json();
}

/** Opens a real WebSocket to the room and buffers every server frame. */
async function connect(code: string) {
  const res = await SELF.fetch(`https://buzzer.test/rooms/${code}/ws`, {
    headers: { Upgrade: "websocket", Origin: ORIGIN, "CF-Connecting-IP": clientIp() },
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

  it("accepts a glob-matched preview origin but not a lookalike", async () => {
    const preview = await SELF.fetch("https://buzzer.test/rooms", {
      method: "POST",
      headers: { Origin: "https://spotify-song-guess-web-git-any-branch-x.vercel.app" },
    });
    expect(preview.status).toBe(200);

    // The glob is anchored and `*` never spans a `/`, so a crafted Origin can't
    // extend a legitimate prefix into someone else's domain.
    const lookalike = await SELF.fetch("https://buzzer.test/rooms", {
      method: "POST",
      headers: { Origin: "https://spotify-song-guess-web-x.vercel.app.evil.com" },
    });
    expect(lookalike.status).toBe(403);
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

describe("order and broadcast", () => {
  it("numbers a buzz by arrival in the round, not by the queue's length after a shift", async () => {
    // After [Ann#1, Bob#2] → Wrong → [Bob#2], Cat used to be #2 as well: two
    // "2." rows on the host's list, and a client matching on order once
    // swallowed her buzz.
    const { code, hostToken } = await createRoom();
    const host = await joinedHost(code, hostToken);
    const ann = await joinedPlayer(code, "p-1", "Ann");
    const bob = await joinedPlayer(code, "p-2", "Bob");
    const cat = await joinedPlayer(code, "p-3", "Cat");
    host.send({ type: "host:open", hostToken });
    await cat.waitFor((m) => m.type === "round:open");
    ann.send({ type: "buzz", roundIndex: 0 });
    await host.waitFor(isBuzz);
    bob.send({ type: "buzz", roundIndex: 0 });
    await host.waitFor((m): m is Extract<ServerMessage, { type: "buzz" }> => m.type === "buzz" && m.entry.name === "Bob");
    host.send({ type: "host:verdict", hostToken, verdict: "wrong" });
    await host.waitFor((m): m is Extract<ServerMessage, { type: "buzz" }> => m.type === "buzz" && m.entry.name === "Bob" && m.phase === "locked");
    cat.send({ type: "buzz", roundIndex: 0 });
    const late = await host.waitFor((m): m is Extract<ServerMessage, { type: "buzz" }> => m.type === "buzz" && m.entry.name === "Cat");
    expect(late.entry.order).toBe(3);

    // A new round starts the count over.
    host.send({ type: "host:next", hostToken });
    await host.waitFor((m): m is Extract<ServerMessage, { type: "state" }> => m.type === "state" && m.snapshot.roundIndex === 1);
    host.send({ type: "host:open", hostToken });
    await cat.waitFor((m): m is Extract<ServerMessage, { type: "round:open" }> => m.type === "round:open" && m.roundIndex === 1);
    cat.send({ type: "buzz", roundIndex: 1 });
    const first = await host.waitFor((m): m is Extract<ServerMessage, { type: "buzz" }> => m.type === "buzz" && m.entry.name === "Cat" && m.entry.order === 1);
    expect(first.entry.order).toBe(1);
  });

  it("sends room frames to joined sockets only, so a refused one keeps showing its refusal", async () => {
    // A `state` frame clears the client's error; a socket refused at join
    // that received one would show a live buzzer for a seat it does not hold.
    const { code, hostToken } = await createRoom();
    const host = await joinedHost(code, hostToken);
    await joinedPlayer(code, "p-1", "Ann");
    const refused = await connect(code);
    refused.send({ type: "join", playerId: "p-2", name: "ann" });
    await refused.waitFor(isError);
    host.send({ type: "host:next", hostToken });
    await host.waitFor(isState);
    await scheduler.wait(100);
    expect(refused.received.map((m) => m.type)).toEqual(["error"]);
  });

  it("treats every seat as possibly the host's on a room persisted before hostPlayerId existed", async () => {
    // The 3h window of rooms live at deploy time: without this, a guest
    // joining under the host's name between the host's sockets took the
    // host's seat — the lockout again. It heals on the host's next join.
    const { code, hostToken } = await createRoom();
    const host = await joinedHost(code, hostToken);
    const ann = await joinedPlayer(code, "p-1", "Ann");
    host.ws.close();
    ann.ws.close();
    await scheduler.wait(50);
    await runInDurableObject(env.BUZZER_ROOM.getByName(code), async (instance, state) => {
      const room = (instance as unknown as { room: { hostPlayerId?: string | null } }).room;
      delete room.hostPlayerId;
      await state.storage.put("room", room);
    });

    for (const name of ["host", "ann"]) {
      const c = await connect(code);
      c.send({ type: "join", playerId: `guest-${name}`, name });
      expect((await c.waitFor(isError)).code, name).toBe("name_taken");
    }

    await joinedHost(code, hostToken);
    const back = await connect(code);
    back.send({ type: "join", playerId: "p-1-after-reload", name: "ann" });
    expect((await back.waitFor(isState)).you.playerId).toBe("p-1-after-reload");
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

  it("hands a disconnected seat to a new id with the same name, queue place included", async () => {
    // A phone whose browser refuses storage mints a new playerId on every
    // page load (lib/use-buzzer-socket.ts). Before this, its own empty seat
    // refused it as `name_taken` until the room's idle alarm, and each retry
    // under another name burned one of the room's twelve seats.
    const { code, hostToken } = await createRoom();
    const host = await joinedHost(code, hostToken);
    const ann = await joinedPlayer(code, "p-1", "Ann");

    host.send({ type: "host:open", hostToken });
    await ann.waitFor((m) => m.type === "round:open");
    ann.send({ type: "buzz", roundIndex: 0 });
    await host.waitFor(isBuzz);

    ann.ws.close();
    await scheduler.wait(50);
    const back = await connect(code);
    back.send({ type: "join", playerId: "p-1-after-reload", name: "ann" });
    const state = await back.waitFor(isState);

    expect(state.you.playerId).toBe("p-1-after-reload");
    expect(state.snapshot.players.filter((p) => p.name.toLowerCase() === "ann")).toHaveLength(1);
    expect(state.snapshot.players.map((p) => p.playerId)).toContain("p-1-after-reload");
    expect(state.snapshot.players.map((p) => p.playerId)).not.toContain("p-1");
    // Her buzz is still first in the queue, under the id she now has.
    expect(state.snapshot.buzzes.map((b) => b.playerId)).toEqual(["p-1-after-reload"]);
  });

  it("gives a seat back to the id that opened it, and tells the taker the name is taken", async () => {
    // Two Alexes at one party: Alex's phone locks, a second Alex joins under
    // the name and takes the empty seat. When the first phone wakes its id
    // outranks the name — that device opened the seat — and the taker is
    // sent to pick another name. Without this the first Alex was refused by
    // a seat that used to be theirs.
    const { code, hostToken } = await createRoom();
    const host = await joinedHost(code, hostToken);
    const alex = await joinedPlayer(code, "p-1", "Alex");
    host.send({ type: "host:open", hostToken });
    await alex.waitFor((m) => m.type === "round:open");
    alex.send({ type: "buzz", roundIndex: 0 });
    await host.waitFor(isBuzz);

    alex.ws.close();
    await scheduler.wait(50);
    const taker = await joinedPlayer(code, "p-2", "alex");
    expect(taker.received.find(isState)?.snapshot.buzzes.map((b) => b.playerId)).toEqual(["p-2"]);

    const back = await connect(code);
    back.send({ type: "join", playerId: "p-1", name: "Alex" });
    const state = await back.waitFor(isState);
    expect(state.you.playerId).toBe("p-1");
    expect(state.snapshot.buzzes.map((b) => b.playerId)).toEqual(["p-1"]);
    expect(state.snapshot.players.filter((p) => p.name.toLowerCase() === "alex")).toHaveLength(1);

    const evicted = await taker.waitFor(isError);
    expect(evicted.code).toBe("name_taken");
  });

  it("keeps the first owner through a chain of takeovers", async () => {
    // A storage-refusing phone reloads twice: p-1 → p-1b → p-1c. The seat
    // remembers p-1, not p-1b, so only the device that opened it can reclaim.
    const { code, hostToken } = await createRoom();
    await joinedHost(code, hostToken);
    const first = await joinedPlayer(code, "p-1", "Ann");
    first.ws.close();
    await scheduler.wait(50);
    const second = await joinedPlayer(code, "p-1b", "Ann");
    second.ws.close();
    await scheduler.wait(50);
    const third = await joinedPlayer(code, "p-1c", "Ann");

    // p-1b was only ever a taker: with p-1c connected it is refused.
    const middle = await connect(code);
    middle.send({ type: "join", playerId: "p-1b", name: "Ann" });
    expect((await middle.waitFor(isError)).code).toBe("name_taken");

    // p-1 opened the seat: it takes it back from p-1c.
    const back = await connect(code);
    back.send({ type: "join", playerId: "p-1", name: "Ann" });
    const state = await back.waitFor(isState);
    expect(state.you.playerId).toBe("p-1");
    expect((await third.waitFor(isError)).code).toBe("name_taken");
  });

  it("refuses a guest the host's name while the host is between sockets, and lets the token back in", async () => {
    // The host's socket closes on the setup → game navigation. A guest who
    // joined as "host" in that gap used to take the host's seat; the host
    // then came back to `name_taken`, every host:* frame died on
    // `not_joined`, and no round could open for anyone.
    const { code, hostToken } = await createRoom();
    const host = await joinedHost(code, hostToken);
    host.ws.close();
    await scheduler.wait(50);

    const squatter = await connect(code);
    squatter.send({ type: "join", playerId: "guest-1", name: "host" });
    expect((await squatter.waitFor(isError)).code).toBe("name_taken");

    const back = await connect(code);
    back.send({ type: "join", playerId: "host-1", name: "Host", hostToken });
    const state = await back.waitFor(isState);
    expect(state.you.isHost).toBe(true);
    back.send({ type: "host:open", hostToken });
    await back.waitFor((m) => m.type === "round:open");
  });

  it("lets the token take the host's name from a guest who claimed it first", async () => {
    // Room created, host not yet connected, a guest joins as "Host". The
    // token outranks the name: the host gets the seat and the guest is sent
    // to pick another name.
    const { code, hostToken } = await createRoom();
    const guest = await joinedPlayer(code, "guest-1", "Host");

    const host = await connect(code);
    host.send({ type: "join", playerId: "host-1", name: "Host", hostToken });
    const state = await host.waitFor(isState);
    expect(state.you.isHost).toBe(true);
    expect(state.snapshot.players.filter((p) => p.name.toLowerCase() === "host")).toHaveLength(1);
    expect((await guest.waitFor(isError)).code).toBe("name_taken");

    // The evicted guest's client re-joins by itself a second later, with the
    // same id and name. The seat the token took has no opener but the token,
    // so there is nothing for that id to reclaim: it is refused, and the host
    // is still the host. (A reclaim that outranked the host's seat here was
    // the lockout again, as a 1 Hz eviction ping-pong.)
    const again = await connect(code);
    again.send({ type: "join", playerId: "guest-1", name: "Host" });
    expect((await again.waitFor(isError)).code).toBe("name_taken");
    host.send({ type: "host:open", hostToken });
    await host.waitFor((m) => m.type === "round:open");
    expect(host.received.some(isError)).toBe(false);
  });

  it("refuses a token-less join that presents the host's previous id", async () => {
    // Every id is broadcast in `players`, so a phone that saw the roster
    // before the host reloaded knows the old host id. Presenting it must not
    // reclaim the host's seat: the token took that seat, and it remembers
    // no opener.
    const { code, hostToken } = await createRoom();
    const host = await joinedHost(code, hostToken);
    host.ws.close();
    await scheduler.wait(50);
    const back = await connect(code);
    back.send({ type: "join", playerId: "host-1-after-reload", name: "Host", hostToken });
    await back.waitFor(isState);

    const impostor = await connect(code);
    impostor.send({ type: "join", playerId: "host-1", name: "Host" });
    expect((await impostor.waitFor(isError)).code).toBe("name_taken");
    back.send({ type: "host:open", hostToken });
    await back.waitFor((m) => m.type === "round:open");
  });

  it("refuses a known id that renames itself onto another seat's name, or rides the host's seat without the token", async () => {
    const { code, hostToken } = await createRoom();
    const host = await joinedHost(code, hostToken);
    await joinedPlayer(code, "p-1", "Ann");
    const bob = await joinedPlayer(code, "p-2", "Bob");

    // Bob's reconnect calling itself Ann: two seats under one name, which
    // the scoreboard keys by, and a way to block Ann's return.
    bob.ws.close();
    await scheduler.wait(50);
    const rename = await connect(code);
    rename.send({ type: "join", playerId: "p-2", name: "ann" });
    expect((await rename.waitFor(isError)).code).toBe("name_taken");

    // The host's current id, learned from the roster, presented without the token.
    const rider = await connect(code);
    rider.send({ type: "join", playerId: "host-1", name: "Host" });
    expect((await rider.waitFor(isError)).code).toBe("name_taken");
    host.send({ type: "host:open", hostToken });
    await host.waitFor((m) => m.type === "round:open");
  });

  it("takes an empty seat by name before the host has ever joined", async () => {
    // A fresh room has no host seat to protect; only a room persisted before
    // the field existed reads as unknown.
    const { code } = await createRoom();
    const ann = await joinedPlayer(code, "p-1", "Ann");
    ann.ws.close();
    await scheduler.wait(50);
    const back = await connect(code);
    back.send({ type: "join", playerId: "p-1-after-reload", name: "ann" });
    const state = await back.waitFor(isState);
    expect(state.you.playerId).toBe("p-1-after-reload");
  });

  it("refuses a reclaim whose new name is already another seat's", async () => {
    const { code, hostToken } = await createRoom();
    await joinedHost(code, hostToken);
    const ann = await joinedPlayer(code, "p-1", "Ann");
    await joinedPlayer(code, "p-2", "Bob");
    ann.ws.close();
    await scheduler.wait(50);
    await joinedPlayer(code, "p-1b", "Ann");

    // p-1 opened Ann's seat, but comes back calling itself Bob.
    const back = await connect(code);
    back.send({ type: "join", playerId: "p-1", name: "bob" });
    expect((await back.waitFor(isError)).code).toBe("name_taken");
  });

  it("replays the queue to everyone when a takeover re-keys a buzz, so the host's Wrong still advances it", async () => {
    // The host's panel advances its local queue by matching the entry the
    // verdict promotes. A re-keyed entry it never heard of was appended
    // instead, leaving the eliminated player at the head on the host's
    // screen and the round awarded to the wrong name.
    const { code, hostToken } = await createRoom();
    const host = await joinedHost(code, hostToken);
    const ann = await joinedPlayer(code, "p-1", "Ann");
    const bob = await joinedPlayer(code, "p-2", "Bob");
    host.send({ type: "host:open", hostToken });
    await bob.waitFor((m) => m.type === "round:open");
    ann.send({ type: "buzz", roundIndex: 0 });
    await host.waitFor(isBuzz);
    bob.send({ type: "buzz", roundIndex: 0 });
    await host.waitFor((m): m is Extract<ServerMessage, { type: "buzz" }> => m.type === "buzz" && m.entry.name === "Bob");

    // Bob, second in the queue, reloads on a phone that keeps no id.
    bob.ws.close();
    await scheduler.wait(50);
    const bobAgain = await connect(code);
    bobAgain.send({ type: "join", playerId: "p-2-after-reload", name: "bob" });
    await bobAgain.waitFor(isState);

    // The host got a full replay naming the new id, not only a roster.
    const replay = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "state" }> =>
        m.type === "state" && m.snapshot.buzzes.some((b) => b.playerId === "p-2-after-reload")
    );
    expect(replay.snapshot.buzzes.map((b) => b.name)).toEqual(["Ann", "Bob"]);

    host.send({ type: "host:verdict", hostToken, verdict: "wrong" });
    // The promotion frame names the id the replay taught everyone, so the
    // client's queue advances instead of appending a stranger.
    const promoted = await host.waitFor(
      (m): m is Extract<ServerMessage, { type: "buzz" }> =>
        m.type === "buzz" && m.phase === "locked" && m.entry.playerId === "p-2-after-reload"
    );
    expect(promoted.entry.name).toBe("Bob");
  });

  it("refuses an id that is a property of Object.prototype", async () => {
    // `players["__proto__"]` is truthy on a plain object: such an id joined
    // as a player nothing could list, count or evict, whose buzz still
    // locked the round.
    const { code, hostToken } = await createRoom();
    await joinedHost(code, hostToken);
    for (const id of ["__proto__", "constructor", "toString"]) {
      const c = await connect(code);
      c.send({ type: "join", playerId: id, name: "Ghost" });
      expect((await c.waitFor(isError)).code, id).toBe("bad_message");
    }
  });

  it("takes an empty seat at the cap instead of counting it as a thirteenth player", async () => {
    // The motivating case is a full room: a reload on a storage-refusing
    // phone must land in its own empty seat rather than be refused as full.
    const { code, hostToken } = await createRoom();
    await joinedHost(code, hostToken);
    const players = [];
    for (let i = 1; i <= 11; i++) players.push(await joinedPlayer(code, `p-${i}`, `Player ${i}`));
    // host + 11 = 12 seats, the cap.
    const thirteenth = await connect(code);
    thirteenth.send({ type: "join", playerId: "p-12", name: "Player 12" });
    expect((await thirteenth.waitFor(isError)).code).toBe("room_full");

    players[4].ws.close();
    await scheduler.wait(50);
    const back = await connect(code);
    back.send({ type: "join", playerId: "p-5-after-reload", name: "player 5" });
    const state = await back.waitFor(isState);
    expect(state.you.playerId).toBe("p-5-after-reload");
    expect(state.snapshot.players).toHaveLength(12);
  });

  it("still refuses the name while its owner is connected", async () => {
    const { code, hostToken } = await createRoom();
    await joinedHost(code, hostToken);
    await joinedPlayer(code, "p-1", "Ann");

    const impostor = await connect(code);
    impostor.send({ type: "join", playerId: "p-2", name: "Ann" });
    const err = await impostor.waitFor(isError);
    expect(err.code).toBe("name_taken");
  });

  it("lets the host back in under a new id after a reload that lost the old one", async () => {
    const { code, hostToken } = await createRoom();
    const host = await joinedHost(code, hostToken);
    host.ws.close();
    await scheduler.wait(50);

    const back = await connect(code);
    back.send({ type: "join", playerId: "host-1-after-reload", name: "Host", hostToken });
    const state = await back.waitFor(isState);
    expect(state.you.isHost).toBe(true);
    expect(state.snapshot.players.filter((p) => p.name === "Host")).toHaveLength(1);
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

/**
 * The Origin check is trivially satisfied by a script running on a page this
 * Worker already allows, so before these limits the WebSocket upgrade was an
 * unmetered oracle for "does this room code exist" — and a 4-character code
 * from a 31-character alphabet is only ~923k combinations.
 */
describe("per-IP rate limits", () => {
  const FLOODER = "198.51.100.7";

  it("cuts off a room-creation flood from one IP", async () => {
    const statuses: number[] = [];
    // The configured budget is 15/min. Thirty attempts from one IP must not all
    // land, or nothing is limiting anything.
    for (let i = 0; i < 30; i++) {
      const res = await SELF.fetch("https://buzzer.test/rooms", {
        method: "POST",
        headers: { Origin: ORIGIN, "CF-Connecting-IP": FLOODER },
      });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
    // Still lets a real host through before it bites.
    expect(statuses[0]).toBe(200);
  });

  it("buckets by IP, so one flooder can't lock everyone else out", async () => {
    for (let i = 0; i < 30; i++) {
      await SELF.fetch("https://buzzer.test/rooms", {
        method: "POST",
        headers: { Origin: ORIGIN, "CF-Connecting-IP": "198.51.100.8" },
      });
    }
    const res = await SELF.fetch("https://buzzer.test/rooms", {
      method: "POST",
      headers: { Origin: ORIGIN, "CF-Connecting-IP": "198.51.100.9" },
    });
    expect(res.status).toBe(200);
  });

  it("refuses a code-guessing sweep on the upgrade before it reaches a room", async () => {
    const sweeper = "198.51.100.10";
    const statuses: number[] = [];
    // Well past the 60/min join budget. Codes are deliberately bogus: the point
    // is that guessing gets throttled, not that any of them exist.
    for (let i = 0; i < 70; i++) {
      const res = await SELF.fetch(`https://buzzer.test/rooms/Z${i % 10}Q${i % 7}/ws`, {
        headers: { Upgrade: "websocket", Origin: ORIGIN, "CF-Connecting-IP": sweeper },
      });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
    // A 429 must arrive *instead of* the 404 that would confirm the code is
    // free — that distinction is the whole oracle.
    expect(statuses.lastIndexOf(429)).toBeGreaterThan(statuses.indexOf(404));
  });

  it("still refuses a disallowed origin before spending any rate-limit budget", async () => {
    const res = await SELF.fetch("https://buzzer.test/rooms", {
      method: "POST",
      headers: { Origin: "https://evil.example", "CF-Connecting-IP": "198.51.100.11" },
    });
    expect(res.status).toBe(403);
  });
});
