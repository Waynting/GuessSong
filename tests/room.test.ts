import { describe, it, expect, vi, beforeEach } from "vitest";
import * as playlistCache from "@/lib/playlist-cache";
import { getKvStore } from "@/lib/kv";
import { createRoom, submitToRoom, getRoomStatus, consumeRoomPool } from "@/lib/room";
import type { Track } from "@/types";

vi.mock("@/lib/playlist-cache", () => ({
  loadPlaylist: vi.fn(),
}));

/** Shape lib/playlist-cache.ts returns; room.ts only reads `tracks`. */
function loaded(tracks: Track[]) {
  return { name: "P", tracks, totalTracks: tracks.length, truncated: false };
}

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: "t1",
    name: "Song",
    artists: ["Artist"],
    durationMs: 200000,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Holds every `loadPlaylist` call open and hands back the resolvers, so a test
 * can park several submissions at the slow step and let them all reach the
 * write together. Counting microtasks by hand is what this replaces — the
 * number of awaits before the fetch is an implementation detail, and a test
 * that encodes it starts passing for the wrong reason the moment it changes.
 */
function gateLoadPlaylist() {
  const gates: Array<(v: Awaited<ReturnType<typeof playlistCache.loadPlaylist>>) => void> = [];
  vi.mocked(playlistCache.loadPlaylist).mockImplementation(
    () => new Promise((resolve) => gates.push(resolve))
  );
  return {
    gates,
    /** Runs the event loop until `count` submissions are waiting on a playlist. */
    async waitFor(count: number) {
      for (let i = 0; i < 100 && gates.length < count; i++) await Promise.resolve();
      expect(gates).toHaveLength(count);
    },
  };
}

describe("room lifecycle", () => {
  beforeEach(() => {
    vi.mocked(playlistCache.loadPlaylist).mockReset();
  });

  it("creates a room with a 4-char code, future expiry, and a host token", async () => {
    const { roomCode, expiresAt, hostToken } = await createRoom();
    expect(roomCode).toHaveLength(4);
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(hostToken).toBeTruthy();
  });

  it("issues a different host token per room", async () => {
    const a = await createRoom();
    const b = await createRoom();
    expect(a.hostToken).not.toBe(b.hostToken);
  });

  // One code, two backends: Buzzer Mode claims its Durable Object first and
  // hands the claimed code here, so a party scans a single QR. See
  // lib/room-client.ts for why claiming first is what makes that safe.
  it("opens a room under a requested code", async () => {
    const { roomCode, hostToken } = await createRoom("AB7K");
    expect(roomCode).toBe("AB7K");
    expect(hostToken).toBeTruthy();
    await expect(getRoomStatus("AB7K")).resolves.toMatchObject({ total: 0 });
  });

  it("uppercases a requested code so a lowercase link hits the same room", async () => {
    const { roomCode } = await createRoom("cd8m");
    expect(roomCode).toBe("CD8M");
  });

  it("refuses a requested code that is already a live room", async () => {
    await createRoom("EF9N");
    // 409 and not a silent join: the caller must claim a different code rather
    // than hand its players someone else's mailbox.
    await expect(createRoom("EF9N")).rejects.toMatchObject({ status: 409 });
  });

  it("rejects a malformed requested code", async () => {
    await expect(createRoom("TOOLONG")).rejects.toMatchObject({ status: 422 });
    await expect(createRoom("AB1K")).rejects.toMatchObject({ status: 422 }); // 1 is not in the alphabet
    await expect(createRoom("")).rejects.toMatchObject({ status: 422 });
  });

  it("submits a playlist and returns its track count", async () => {
    vi.mocked(playlistCache.loadPlaylist).mockResolvedValue(loaded([makeTrack({ id: "a" }), makeTrack({ id: "b" })]));
    const { roomCode } = await createRoom();
    const result = await submitToRoom(roomCode, "Alice", "https://open.spotify.com/playlist/abc");
    expect(result.trackCount).toBe(2);
    // Named, so the cache's miss log identifies this path even when the log
    // viewer attributes the line to an unrelated concurrent request.
    expect(playlistCache.loadPlaylist).toHaveBeenCalledWith(
      "https://open.spotify.com/playlist/abc",
      "room-submit"
    );
  });

  it("rejects a duplicate name (case-insensitive) in the same room", async () => {
    vi.mocked(playlistCache.loadPlaylist).mockResolvedValue(loaded([makeTrack()]));
    const { roomCode } = await createRoom();
    await submitToRoom(roomCode, "Alice", "url1");
    await expect(submitToRoom(roomCode, "alice", "url2")).rejects.toMatchObject({ status: 409 });
  });

  it("rejects submission to an unknown room", async () => {
    await expect(submitToRoom("ZZZZ", "Alice", "url")).rejects.toMatchObject({ status: 404 });
  });

  it("propagates playlist parse failures as 422", async () => {
    vi.mocked(playlistCache.loadPlaylist).mockRejectedValue(new Error("bad playlist"));
    const { roomCode } = await createRoom();
    await expect(submitToRoom(roomCode, "Alice", "bad-url")).rejects.toMatchObject({
      status: 422,
    });
  });

  it("status reports only names and track counts, never track contents", async () => {
    vi.mocked(playlistCache.loadPlaylist).mockResolvedValue(loaded([makeTrack({ id: "a" }), makeTrack({ id: "b" }), makeTrack({ id: "c" })]));
    const { roomCode } = await createRoom();
    await submitToRoom(roomCode, "Alice", "url");
    const status = await getRoomStatus(roomCode);
    expect(status.submissions).toEqual([{ playerName: "Alice", trackCount: 3 }]);
    expect(status.total).toBe(1);
    expect(JSON.stringify(status)).not.toContain("Song");
  });

  it("pools submissions, marks the room consumed, and blocks further activity", async () => {
    vi.mocked(playlistCache.loadPlaylist)
      .mockResolvedValueOnce(loaded([makeTrack({ id: "a", name: "A" })]))
      .mockResolvedValueOnce(loaded([makeTrack({ id: "b", name: "B" })]));
    const { roomCode, hostToken } = await createRoom();
    await submitToRoom(roomCode, "Alice", "url1");
    await submitToRoom(roomCode, "Bob", "url2");

    const pool = await consumeRoomPool(roomCode, 8, hostToken);
    expect(pool.players.slice().sort()).toEqual(["Alice", "Bob"]);
    expect(pool.tracks).toHaveLength(2);

    await expect(submitToRoom(roomCode, "Carol", "url3")).rejects.toMatchObject({ status: 410 });
    await expect(consumeRoomPool(roomCode, 8, hostToken)).rejects.toMatchObject({ status: 410 });
  });

  it("rejects pool consumption with no submissions yet", async () => {
    const { roomCode, hostToken } = await createRoom();
    await expect(consumeRoomPool(roomCode, 8, hostToken)).rejects.toMatchObject({ status: 422 });
  });

  it("rejects pool consumption with a wrong or missing host token", async () => {
    vi.mocked(playlistCache.loadPlaylist).mockResolvedValue(loaded([makeTrack()]));
    const { roomCode } = await createRoom();
    await submitToRoom(roomCode, "Alice", "url1");

    await expect(consumeRoomPool(roomCode, 8, "wrong-token")).rejects.toMatchObject({ status: 403 });
    await expect(consumeRoomPool(roomCode, 8, "")).rejects.toMatchObject({ status: 403 });
  });

  it("does not lose a submission when two players submit at nearly the same time", async () => {
    const { roomCode } = await createRoom();

    // Alice's request stalls on the Spotify fetch (the slow part of
    // submitToRoom) while Bob's request runs to completion first — this
    // reproduces the interleaving that used to silently drop whichever
    // submission wrote last against a stale in-memory copy of the record.
    let resolveAlice!: (v: Awaited<ReturnType<typeof playlistCache.loadPlaylist>>) => void;
    const alicePending = new Promise<Awaited<ReturnType<typeof playlistCache.loadPlaylist>>>(
      (resolve) => {
        resolveAlice = resolve;
      }
    );
    vi.mocked(playlistCache.loadPlaylist)
      .mockImplementationOnce(() => alicePending)
      .mockResolvedValueOnce(loaded([makeTrack({ id: "b" })]));

    const submitAlice = submitToRoom(roomCode, "Alice", "url-alice");
    await Promise.resolve();
    await Promise.resolve();

    await submitToRoom(roomCode, "Bob", "url-bob");
    resolveAlice(loaded([makeTrack({ id: "a" })]));
    await submitAlice;

    const status = await getRoomStatus(roomCode);
    expect(status.submissions.map((s) => s.playerName).sort()).toEqual(["Alice", "Bob"]);
  });

  it("gives the name to exactly one of two players racing for it", async () => {
    // Both get past the pre-fetch duplicate check — neither can see the other
    // yet — and then both try to write. The claim is a single atomic field set,
    // so one wins outright; there is no window in which the second overwrites
    // the first and both are told they are in.
    const { roomCode } = await createRoom();
    const { gates, waitFor } = gateLoadPlaylist();

    const first = submitToRoom(roomCode, "Alice", "url-1");
    const second = submitToRoom(roomCode, "ALICE", "url-2");
    await waitFor(2);

    gates[0](loaded([makeTrack({ id: "a" })]));
    gates[1](loaded([makeTrack({ id: "b" })]));
    const outcomes = await Promise.allSettled([first, second]);

    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((r) => r.status === "rejected");
    expect(rejected && (rejected as PromiseRejectedResult).reason).toMatchObject({
      status: 409,
    });

    const status = await getRoomStatus(roomCode);
    expect(status.total).toBe(1);
  });

  it("lists the roster in arrival order", async () => {
    // Contributions live in hash fields, which have no order of their own. A
    // roster that reshuffled between polls would be a visible defect on the one
    // screen a whole room is looking at.
    vi.mocked(playlistCache.loadPlaylist).mockResolvedValue(loaded([makeTrack()]));
    const { roomCode } = await createRoom();

    for (const name of ["Alice", "Bob", "Carol"]) {
      await submitToRoom(roomCode, name, `url-${name}`);
    }

    const status = await getRoomStatus(roomCode);
    expect(status.submissions.map((s) => s.playerName)).toEqual(["Alice", "Bob", "Carol"]);
  });

  it("refuses a submission that lands after the host has started", async () => {
    // The one thing still worth re-reading for after the claim: a player who
    // was fetching a playlist while the host pressed Start must be told the
    // game began, not shown a tick for a playlist nothing will ever play.
    const { roomCode, hostToken } = await createRoom();
    vi.mocked(playlistCache.loadPlaylist).mockResolvedValueOnce(loaded([makeTrack({ id: "a" })]));
    await submitToRoom(roomCode, "Alice", "url-1");

    const { gates, waitFor } = gateLoadPlaylist();
    const late = submitToRoom(roomCode, "Bob", "url-2");
    await waitFor(1);

    await consumeRoomPool(roomCode, 8, hostToken);
    gates[0](loaded([makeTrack({ id: "b" })]));

    await expect(late).rejects.toMatchObject({ status: 410 });
  });

  it("releases the room when a consume finds no tracks to pool", async () => {
    // Claiming `consumed` is how the consume race is decided, so it has to
    // happen before we know whether the track keys are still there. If they are
    // not, the host's Start failed — and a failed Start must not leave them
    // holding a room that can never be started again.
    vi.mocked(playlistCache.loadPlaylist).mockResolvedValue(loaded([makeTrack()]));
    const { roomCode, hostToken } = await createRoom();
    await submitToRoom(roomCode, "Alice", "url-1");

    const store = await getKvStore();
    await store.del(`room:v2:${roomCode}:t:alice`);

    await expect(consumeRoomPool(roomCode, 8, hostToken)).rejects.toMatchObject({
      status: 422,
    });
    // Not 410: the room is open again, so a retry after the tracks are
    // resubmitted can still work.
    await expect(getRoomStatus(roomCode)).resolves.toMatchObject({ total: 1 });
    await expect(consumeRoomPool(roomCode, 8, hostToken)).rejects.toMatchObject({
      status: 422,
    });
  });

  it("only lets one of two concurrent pool-consume calls succeed", async () => {
    vi.mocked(playlistCache.loadPlaylist)
      .mockResolvedValueOnce(loaded([makeTrack({ id: "a" })]))
      .mockResolvedValueOnce(loaded([makeTrack({ id: "b" })]));
    const { roomCode, hostToken } = await createRoom();
    await submitToRoom(roomCode, "Alice", "url1");
    await submitToRoom(roomCode, "Bob", "url2");

    const [first, second] = await Promise.allSettled([
      consumeRoomPool(roomCode, 8, hostToken),
      consumeRoomPool(roomCode, 8, hostToken),
    ]);

    const outcomes = [first, second];
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((r) => r.status === "rejected");
    expect(rejected && (rejected as PromiseRejectedResult).reason).toMatchObject({ status: 410 });
  });
});
