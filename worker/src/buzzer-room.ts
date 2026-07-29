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
}

interface PlayerRecord {
  name: string;
}

interface RoomState {
  code: string;
  /** Null until a host claims the room. An unclaimed room refuses connections. */
  hostToken: string | null;
  phase: BuzzerPhase;
  roundIndex: number;
  roundOpenedAt: number | null;
  buzzes: BuzzEntry[];
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
    phase: "idle",
    roundIndex: 0,
    roundOpenedAt: null,
    buzzes: [],
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
    const name = rawName.trim().slice(0, 24);
    if (!playerId || !name) {
      return this.sendError(ws, "bad_message", "playerId and name are required");
    }

    const isHost = this.isHostToken(hostToken);
    const known = this.room.players[playerId];

    if (!known) {
      if (Object.keys(this.room.players).length >= BUZZER_MAX_PLAYERS) {
        return this.sendError(ws, "room_full", "This room is full");
      }
      const clash = Object.entries(this.room.players).some(
        ([id, p]) => id !== playerId && p.name.toLowerCase() === name.toLowerCase()
      );
      if (clash) return this.sendError(ws, "name_taken", "That name is already taken");
      this.room.players[playerId] = { name };
    } else {
      known.name = name;
    }

    ws.serializeAttachment({ playerId, name, isHost } satisfies SocketAttachment);
    await this.persist();

    // Full-state replay. Reconnects are indistinguishable from first joins on
    // purpose: the client throws away whatever it had and adopts this.
    this.send(ws, { type: "state", snapshot: this.snapshot(), you: { playerId, isHost } });
    this.broadcastPlayers();
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
      order: this.room.buzzes.length + 1,
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

  private playerSummaries(): PlayerSummary[] {
    const connected = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attachment(ws);
      if (att) connected.add(att.playerId);
    }
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
