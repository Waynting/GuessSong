import { DurableObject } from "cloudflare:workers";
import {
  BUZZER_IDLE_TIMEOUT_MS,
  BUZZER_MAX_PLAYERS,
  parseClientMessage,
  type BuzzEntry,
  type BuzzerErrorCode,
  type BuzzerPhase,
  type PlayerSummary,
  type RoomSnapshot,
  type RoundVerdict,
  type ServerMessage,
} from "../../lib/buzzer-protocol";

export interface Env {
  BUZZER_ROOM: DurableObjectNamespace<BuzzerRoom>;
  ALLOWED_ORIGINS: string;
  /**
   * Per-IP throttles on the two public entry points. Optional so a
   * `wrangler dev` or vitest run without the bindings still works — see
   * rateLimited() in index.ts for what an absent binding means.
   */
  BUZZER_JOIN_LIMIT?: RateLimit;
  BUZZER_CREATE_LIMIT?: RateLimit;
}

interface PlayerRecord {
  name: string;
  /**
   * The id this seat was first taken under, once another id has taken it
   * over (a phone that lost its own id — a browser that keeps no storage
   * mints one per page load). That id, and only that id, reclaims the seat
   * on return; an adopter holds it only while the first owner is away. Kept
   * as the *first* owner through a chain of adoptions, so it is the device
   * that opened the seat which wins, never the latest squatter.
   */
  adoptedFrom?: string;
}

interface RoomState {
  code: string;
  /** Null until a host claims the room. An unclaimed room refuses connections. */
  hostToken: string | null;
  /**
   * The id the host's seat is under, set on every join that carries the
   * token. Nothing but a join with the token may take that seat: the host's
   * socket closes on the `/` → `/game` navigation, and a guest who joined
   * as "Host" in that gap used to take the seat and lock the token holder
   * out of their own room. Null until the host's first join — nothing to
   * protect yet — and absent on rooms persisted before this field, which is
   * read as "unknown": no empty seat is taken by name there until a token
   * join has said which one is the host's.
   */
  hostPlayerId?: string | null;
  phase: BuzzerPhase;
  roundIndex: number;
  roundOpenedAt: number | null;
  buzzes: BuzzEntry[];
  /**
   * Buzzes handed out this round, so `order` is the arrival order the
   * protocol promises and not the queue's length: after a wrong verdict
   * shifts the queue, the next buzz used to take the surviving head's
   * number, and the host's list read "2. Bob / 2. Cat". Absent on rooms
   * persisted before the field; read as 0.
   */
  buzzCount?: number;
  players: Record<string, PlayerRecord>;
  createdAt: number;
  expiresAt: number;
}

/** What we hang off each socket so a hibernated object can still identify it. */
interface SocketAttachment {
  playerId: string;
  name: string;
  isHost: boolean;
}

const STORAGE_KEY = "room";

function emptyState(code: string, now: number): RoomState {
  return {
    code,
    hostToken: null,
    hostPlayerId: null,
    phase: "idle",
    roundIndex: 0,
    roundOpenedAt: null,
    buzzes: [],
    buzzCount: 0,
    players: {},
    createdAt: now,
    expiresAt: now + BUZZER_IDLE_TIMEOUT_MS,
  };
}

/**
 * One instance per room code (`env.BUZZER_ROOM.getByName(code)`), which is the
 * entire reason this design works: every phone in a given party talks to the
 * *same* object, so "who pressed first" is decided by one single-threaded
 * runtime with no lock, no compare-and-swap, and no retry loop.
 *
 * ```
 *   phase: idle ──host:open──▶ open ──first buzz──▶ locked
 *            ▲                  │                    │
 *            │                  │                    ├─ verdict "correct" ─┐
 *            │                  └── host:reveal ─────┤                     │
 *            │                                       ├─ verdict "wrong" ───┤
 *            │                                       │   (queue advances,  │
 *            │                                       │    stays locked;    │
 *            │                                       │    empty queue →    │
 *            │                                       │    back to open)    │
 *            └───────────────── host:next ───────────┴─────────────────────┘
 * ```
 *
 * Hibernation note: between rounds this object is evicted from memory while the
 * sockets stay open, so nothing may live *only* in `this.room`. The constructor
 * reloads from storage under `blockConcurrencyWhile`, which is what lets every
 * handler below read `this.room` synchronously.
 */
export class BuzzerRoom extends DurableObject<Env> {
  private room!: RoomState;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // The one legitimate use of blockConcurrencyWhile: hydrate before any
    // request is served. Doing this lazily inside handlers would put an `await`
    // in front of the buzz comparison and reintroduce exactly the race this
    // whole architecture exists to avoid.
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<RoomState>(STORAGE_KEY);
      this.room = stored ?? emptyState("", Date.now());
    });
  }

  // -------------------------------------------------------------------------
  // RPC (called by the Worker, not by browsers)
  // -------------------------------------------------------------------------

  /**
   * Claims an unclaimed room and mints its host token. Returns null if the code
   * is already taken, which is how the Worker detects a code collision and
   * retries with a fresh one.
   *
   * The token is minted *here* rather than passed in from Vercel so there is no
   * shared secret to keep in sync across two platforms.
   */
  async claim(code: string): Promise<{ hostToken: string; expiresAt: number } | null> {
    if (this.room.hostToken) return null;
    const now = Date.now();
    this.room = emptyState(code, now);
    this.room.hostToken = crypto.randomUUID();
    await this.persist();
    await this.ctx.storage.setAlarm(this.room.expiresAt);
    return { hostToken: this.room.hostToken, expiresAt: this.room.expiresAt };
  }

  /** True if this code has been claimed and has not expired. */
  async exists(): Promise<boolean> {
    return this.room.hostToken !== null && Date.now() < this.room.expiresAt;
  }

  // -------------------------------------------------------------------------
  // WebSocket lifecycle
  // -------------------------------------------------------------------------

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket upgrade", { status: 426 });
    }
    if (!(await this.exists())) {
      // Refuse before accepting, so probing the ~1M code space never opens a
      // socket. It does still instantiate this object; an unclaimed room writes
      // nothing and hibernates immediately, so the cost is a bare request.
      return new Response("Room not found or expired", { status: 404 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // acceptWebSocket (not server.accept()) is what opts this room into
    // hibernation: the runtime can evict us between rounds and still hold the
    // sockets open, so an idle room costs nothing.
    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    const msg = parseClientMessage(text);
    if (!msg) return this.sendError(ws, "bad_message", "Unrecognised message");

    if (Date.now() >= this.room.expiresAt) {
      this.sendError(ws, "room_expired", "This room has expired");
      ws.close(1000, "expired");
      return;
    }

    if (msg.type === "ping") return this.send(ws, { type: "pong" });
    if (msg.type === "join") return this.handleJoin(ws, msg.playerId, msg.name, msg.hostToken);

    const att = this.attachment(ws);
    if (!att) return this.sendError(ws, "not_joined", "Send a join message first");

    if (msg.type === "buzz") return this.handleBuzz(ws, att, msg.roundIndex);

    // Everything below is host-only. Compare against the stored token before
    // acting — without this any player could open a round or award points.
    if (!this.isHostToken(msg.hostToken)) {
      return this.sendError(ws, "not_host", "Host action requires the host token");
    }

    switch (msg.type) {
      case "host:open":
        return this.handleOpen();
      case "host:verdict":
        return this.handleVerdict(msg.verdict);
      case "host:reveal":
        return this.handleResolve("revealed");
      case "host:next":
        return this.handleNext();
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    // The player record survives — identity is the localStorage playerId, not
    // the socket, so a phone that drops and reconnects keeps its name and its
    // place in the queue.
    const att = this.attachment(ws);
    if (att) this.broadcastPlayers();
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.broadcastPlayers();
  }

  override async alarm(): Promise<void> {
    if (Date.now() < this.room.expiresAt) {
      // A host action slid the deadline out after this alarm was scheduled.
      await this.ctx.storage.setAlarm(this.room.expiresAt);
      return;
    }
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, { type: "error", code: "room_expired", message: "This room has expired" });
      ws.close(1000, "expired");
    }
    await this.ctx.storage.deleteAll();
    this.room = emptyState("", Date.now());
  }

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  private async handleJoin(
    ws: WebSocket,
    playerId: string,
    rawName: string,
    hostToken?: string
  ): Promise<void> {
    // The id is a hash key the room persists under and a value it broadcasts,
    // and `parseClientMessage` checks nothing past `type`. A bare object
    // read of `players["__proto__"]` is truthy, so an unchecked id joined as
    // a player nothing could list, count or evict, whose buzz still locked
    // the round. Bounded and own-key only, before it is used for anything.
    const name = typeof rawName === "string" ? rawName.trim().slice(0, 24) : "";
    if (typeof playerId !== "string" || !playerId || playerId.length > 64 || !name) {
      return this.sendError(ws, "bad_message", "playerId and name are required");
    }
    if (Object.hasOwn(Object.prototype, playerId)) {
      return this.sendError(ws, "bad_message", "playerId is not a valid id");
    }

    const isHost = this.isHostToken(hostToken);
    const known = Object.hasOwn(this.room.players, playerId) ? this.room.players[playerId] : undefined;
    const lower = name.toLowerCase();
    let rekeyedBuzz = false;

    if (!known) {
      const ids = Object.keys(this.room.players);
      const sameName = (id: string) => id !== playerId && this.room.players[id].name.toLowerCase() === lower;
      // The seat this id opened and then lost to another id — see
      // `adoptedFrom`. A reclaim is refused by nothing but the host's seat.
      const reclaimId = ids.find((id) => this.room.players[id].adoptedFrom === playerId);
      const clashId = reclaimId ?? ids.find(sameName);
      if (clashId !== undefined) {
        const holderConnected = this.connectedIds().has(clashId);
        // Unknown on a room persisted before the field: then every seat is
        // treated as possibly the host's until a token join says otherwise.
        const holderIsHost = this.room.hostPlayerId === undefined || clashId === this.room.hostPlayerId;
        // Who may take a seat that is already somebody's, in order:
        //  - the token, always — it is the authority, and nothing else may
        //    ever take the seat it holds: a guest who joined as "Host" while
        //    the host was between sockets used to lock the token holder out,
        //    and a reclaim that outranked the host's seat brought that back
        //    one reconnect later;
        //  - the id that opened the seat, from anyone but the token;
        //  - anyone with the name, only if the seat is empty (no socket) and
        //    not the host's. A phone that lost its playerId — a browser that
        //    refuses storage mints one per page load — reloads into its own
        //    empty seat this way; before this it was refused by that seat
        //    until the room's idle alarm, and every retry under a new name
        //    burned another of the room's twelve. Taking the seat keeps its
        //    name, its place in the queue and, on the host's screen, its
        //    score, which is awarded by name.
        const mayTake = isHost || (!holderIsHost && (reclaimId !== undefined || !holderConnected));
        if (!mayTake) return this.sendError(ws, "name_taken", "That name is already taken");
        // A reclaim presenting a name a third seat holds would be two seats
        // under one name, which the scoreboard keys by.
        if (reclaimId !== undefined && ids.some((id) => id !== reclaimId && sameName(id))) {
          return this.sendError(ws, "name_taken", "That name is already taken");
        }
        rekeyedBuzz = this.takeSeat(clashId, playerId, holderConnected, isHost);
        this.room.players[playerId].name = name;
      } else {
        if (ids.length >= BUZZER_MAX_PLAYERS) {
          return this.sendError(ws, "room_full", "This room is full");
        }
        this.room.players[playerId] = { name };
      }
    } else {
      // A known id is broadcast to every phone in the room, so it is not a
      // credential either: the same two rules as a new id, or a join with
      // someone's id could rename their seat to a name that blocks a third
      // player's return, or ride the host's seat without the token.
      if (!isHost && playerId === this.room.hostPlayerId) {
        return this.sendError(ws, "name_taken", "That name is already taken");
      }
      if (Object.keys(this.room.players).some((id) => id !== playerId && this.room.players[id].name.toLowerCase() === lower)) {
        return this.sendError(ws, "name_taken", "That name is already taken");
      }
      known.name = name;
    }
    if (isHost) this.room.hostPlayerId = playerId;

    ws.serializeAttachment({ playerId, name, isHost } satisfies SocketAttachment);
    await this.persist();

    // Full-state replay. Reconnects are indistinguishable from first joins on
    // purpose: the client throws away whatever it had and adopts this.
    this.send(ws, { type: "state", snapshot: this.snapshot(), you: { playerId, isHost } });
    if (rekeyedBuzz) {
      // Everyone else's queue still names the old id, and the client
      // advances its queue by matching the entry the host's verdict moves
      // to the head — an id nobody knows is appended instead, and the
      // round goes to the wrong name on the host's screen. The same replay
      // handleNext sends, for the same reason.
      this.broadcast({ type: "state", snapshot: this.snapshot(), you: { playerId: "", isHost: false } });
    } else {
      this.broadcastPlayers();
    }
  }

  private async handleBuzz(
    ws: WebSocket,
    att: SocketAttachment,
    roundIndex: number
  ): Promise<void> {
    const now = Date.now();
    const player = this.room.players[att.playerId];
    if (!player) return this.sendError(ws, "not_joined", "Send a join message first");

    // ---- atomic region: not a single `await` between here and the push ----
    // This is the whole ballgame. JS runs one task to completion, and a Durable
    // Object is single-threaded, so no other buzz can observe this state
    // mid-update. The moment an `await` appears above the push, two phones can
    // both read `buzzes.length === 0` and both believe they were first.
    // "locked" accepts buzzes too — it means someone got there first, not that
    // the round is closed. Everyone after the winner queues behind them, which
    // is what makes a wrong answer able to pass the question down the line
    // instead of dead-ending the round.
    if (this.room.phase !== "open" && this.room.phase !== "locked") return;
    if (roundIndex !== this.room.roundIndex) return;
    if (this.room.buzzes.some((b) => b.playerId === att.playerId)) return;

    const entry: BuzzEntry = {
      playerId: att.playerId,
      name: player.name,
      order: (this.room.buzzCount = (this.room.buzzCount ?? 0) + 1),
      msSinceOpen: this.room.roundOpenedAt ? now - this.room.roundOpenedAt : 0,
    };
    this.room.buzzes.push(entry);
    if (entry.order === 1) this.room.phase = "locked";
    const phase = this.room.phase;
    // ---- end atomic region ----

    // Persist before telling anyone. If this object died between the push and
    // the write, storage would win on restart and the buzz would vanish — so
    // announcing first could show a winner that no longer exists.
    await this.persist();
    this.broadcast({ type: "buzz", entry, phase });
  }

  private async handleOpen(): Promise<void> {
    const now = Date.now();
    this.room.phase = "open";
    this.room.roundOpenedAt = now;
    this.room.buzzes = [];
    this.room.buzzCount = 0;
    await this.touch();
    this.broadcast({ type: "round:open", roundIndex: this.room.roundIndex, openedAt: now });
  }

  private async handleVerdict(verdict: "correct" | "wrong"): Promise<void> {
    if (this.room.phase !== "locked") return;

    if (verdict === "correct") return this.handleResolve("correct");

    // Wrong answer: the queue advances. Whoever was second is now on the spot,
    // and if nobody else buzzed the round reopens for everyone.
    this.room.buzzes.shift();
    const phase: BuzzerPhase = this.room.buzzes.length > 0 ? "locked" : "open";
    this.room.phase = phase;
    if (phase === "open") this.room.roundOpenedAt = Date.now();
    await this.touch();

    const next = this.room.buzzes[0];
    if (next) this.broadcast({ type: "buzz", entry: next, phase });
    else
      this.broadcast({
        type: "round:open",
        roundIndex: this.room.roundIndex,
        openedAt: this.room.roundOpenedAt ?? Date.now(),
      });
  }

  private async handleResolve(verdict: RoundVerdict): Promise<void> {
    const roundIndex = this.room.roundIndex;
    this.room.phase = "idle";
    this.room.roundOpenedAt = null;
    await this.touch();
    this.broadcast({ type: "round:resolved", roundIndex, verdict });
  }

  private async handleNext(): Promise<void> {
    this.room.roundIndex += 1;
    this.room.phase = "idle";
    this.room.roundOpenedAt = null;
    this.room.buzzes = [];
    this.room.buzzCount = 0;
    await this.touch();
    this.broadcast({ type: "state", snapshot: this.snapshot(), you: { playerId: "", isHost: false } });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Persist, then slide the expiry deadline out. Buzzer rooms are the opposite
   * of Mixed Playlist rooms: a game that runs long is normal, so activity has to
   * extend the room rather than let it die mid-party.
   */
  private async touch(): Promise<void> {
    this.room.expiresAt = Date.now() + BUZZER_IDLE_TIMEOUT_MS;
    await this.persist();
    await this.ctx.storage.setAlarm(this.room.expiresAt);
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put(STORAGE_KEY, this.room);
  }

  private isHostToken(token: string | undefined): boolean {
    // Both sides are server-generated UUIDs of equal length, so a plain compare
    // leaks nothing useful about a secret an attacker would have to guess whole.
    return Boolean(token && this.room.hostToken && token === this.room.hostToken);
  }

  private attachment(ws: WebSocket): SocketAttachment | null {
    const raw = ws.deserializeAttachment();
    return raw && typeof raw === "object" ? (raw as SocketAttachment) : null;
  }

  private snapshot(): RoomSnapshot {
    return {
      code: this.room.code,
      phase: this.room.phase,
      roundIndex: this.room.roundIndex,
      roundOpenedAt: this.room.roundOpenedAt,
      buzzes: this.room.buzzes,
      players: this.playerSummaries(),
      expiresAt: this.room.expiresAt,
    };
  }

  /**
   * Re-key a seat, and every buzz standing on it, to the id that took it
   * over. The seat remembers its first owner unless that owner is the one
   * taking it back — or the token is: a seat the token holds has no owner
   * but the token, so an evicted squatter is never recorded as its opener
   * (its client re-joins on its own a second later, and a reclaim there was
   * the host locked out of the room again). A holder still on a socket is
   * told the name is taken and closed, so its phone shows a real screen
   * rather than a buzzer that answers `not_joined` from then on. Returns
   * whether a queued buzz was re-keyed, which the caller has to tell the
   * room about.
   */
  private takeSeat(fromId: string, toId: string, evictHolder: boolean, byToken: boolean): boolean {
    const record = this.room.players[fromId];
    delete this.room.players[fromId];
    const firstOwner = record.adoptedFrom ?? fromId;
    this.room.players[toId] =
      byToken || firstOwner === toId ? { name: record.name } : { name: record.name, adoptedFrom: firstOwner };
    // The host's seat is only ever taken with the token, and handleJoin
    // then writes `hostPlayerId = playerId` itself — no repoint here, so
    // the suite's coverage of that invariant is the line that holds it.
    let rekeyed = false;
    for (const entry of this.room.buzzes) {
      if (entry.playerId === fromId) {
        entry.playerId = toId;
        rekeyed = true;
      }
    }
    if (!evictHolder) return rekeyed;
    for (const ws of this.ctx.getWebSockets()) {
      if (this.attachment(ws)?.playerId !== fromId) continue;
      this.sendError(ws, "name_taken", "That name is already taken");
      try {
        ws.close(1000, "seat taken");
      } catch {
        // Already gone; webSocketClose reconciles.
      }
    }
    return rekeyed;
  }

  /** The ids with a live socket right now. */
  private connectedIds(): Set<string> {
    const connected = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attachment(ws);
      if (att) connected.add(att.playerId);
    }
    return connected;
  }

  private playerSummaries(): PlayerSummary[] {
    const connected = this.connectedIds();
    return Object.entries(this.room.players).map(([playerId, p]) => ({
      playerId,
      name: p.name,
      connected: connected.has(playerId),
    }));
  }

  private broadcastPlayers(): void {
    this.broadcast({ type: "players", players: this.playerSummaries() });
  }

  private broadcast(msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      // Joined sockets only. A socket that was refused at join stays open
      // showing its refusal, and a `state` frame would blank that screen
      // into a live buzzer for a seat it does not hold.
      if (!this.attachment(ws)) continue;
      try {
        ws.send(payload);
      } catch {
        // Socket died between getWebSockets() and send(); webSocketClose will
        // reconcile. One dead phone must never abort the broadcast to the rest.
      }
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* closed mid-send; nothing useful to do */
    }
  }

  private sendError(ws: WebSocket, code: BuzzerErrorCode, message: string): void {
    this.send(ws, { type: "error", code, message });
  }
}
