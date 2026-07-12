import { describe, it, expect, vi, beforeEach } from "vitest";
import * as spotify from "@/lib/spotify";
import type { SpotifyPlaylist } from "@/lib/spotify";
import { createRoom, submitToRoom, getRoomStatus, consumeRoomPool } from "@/lib/room";
import type { Track } from "@/types";

vi.mock("@/lib/spotify", () => ({
  getPlaylistWithTracks: vi.fn(),
}));

const FAKE_PLAYLIST: SpotifyPlaylist = {
  id: "p",
  name: "P",
  tracks: { items: [], total: 0 },
};

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

describe("room lifecycle", () => {
  beforeEach(() => {
    vi.mocked(spotify.getPlaylistWithTracks).mockReset();
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

  it("submits a playlist and returns its track count", async () => {
    vi.mocked(spotify.getPlaylistWithTracks).mockResolvedValue({
      playlist: FAKE_PLAYLIST,
      tracks: [makeTrack({ id: "a" }), makeTrack({ id: "b" })],
    });
    const { roomCode } = await createRoom();
    const result = await submitToRoom(roomCode, "Alice", "https://open.spotify.com/playlist/abc");
    expect(result.trackCount).toBe(2);
  });

  it("rejects a duplicate name (case-insensitive) in the same room", async () => {
    vi.mocked(spotify.getPlaylistWithTracks).mockResolvedValue({
      playlist: FAKE_PLAYLIST,
      tracks: [makeTrack()],
    });
    const { roomCode } = await createRoom();
    await submitToRoom(roomCode, "Alice", "url1");
    await expect(submitToRoom(roomCode, "alice", "url2")).rejects.toMatchObject({ status: 409 });
  });

  it("rejects submission to an unknown room", async () => {
    await expect(submitToRoom("ZZZZ", "Alice", "url")).rejects.toMatchObject({ status: 404 });
  });

  it("propagates playlist parse failures as 422", async () => {
    vi.mocked(spotify.getPlaylistWithTracks).mockRejectedValue(new Error("bad playlist"));
    const { roomCode } = await createRoom();
    await expect(submitToRoom(roomCode, "Alice", "bad-url")).rejects.toMatchObject({
      status: 422,
    });
  });

  it("status reports only names and track counts, never track contents", async () => {
    vi.mocked(spotify.getPlaylistWithTracks).mockResolvedValue({
      playlist: FAKE_PLAYLIST,
      tracks: [makeTrack({ id: "a" }), makeTrack({ id: "b" }), makeTrack({ id: "c" })],
    });
    const { roomCode } = await createRoom();
    await submitToRoom(roomCode, "Alice", "url");
    const status = await getRoomStatus(roomCode);
    expect(status.submissions).toEqual([{ playerName: "Alice", trackCount: 3 }]);
    expect(status.total).toBe(1);
    expect(JSON.stringify(status)).not.toContain("Song");
  });

  it("pools submissions, marks the room consumed, and blocks further activity", async () => {
    vi.mocked(spotify.getPlaylistWithTracks)
      .mockResolvedValueOnce({ playlist: FAKE_PLAYLIST, tracks: [makeTrack({ id: "a", name: "A" })] })
      .mockResolvedValueOnce({ playlist: FAKE_PLAYLIST, tracks: [makeTrack({ id: "b", name: "B" })] });
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
    vi.mocked(spotify.getPlaylistWithTracks).mockResolvedValue({
      playlist: FAKE_PLAYLIST,
      tracks: [makeTrack()],
    });
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
    let resolveAlice!: (v: Awaited<ReturnType<typeof spotify.getPlaylistWithTracks>>) => void;
    const alicePending = new Promise<Awaited<ReturnType<typeof spotify.getPlaylistWithTracks>>>(
      (resolve) => {
        resolveAlice = resolve;
      }
    );
    vi.mocked(spotify.getPlaylistWithTracks)
      .mockImplementationOnce(() => alicePending)
      .mockResolvedValueOnce({ playlist: FAKE_PLAYLIST, tracks: [makeTrack({ id: "b" })] });

    const submitAlice = submitToRoom(roomCode, "Alice", "url-alice");
    await Promise.resolve();
    await Promise.resolve();

    await submitToRoom(roomCode, "Bob", "url-bob");
    resolveAlice({ playlist: FAKE_PLAYLIST, tracks: [makeTrack({ id: "a" })] });
    await submitAlice;

    const status = await getRoomStatus(roomCode);
    expect(status.submissions.map((s) => s.playerName).sort()).toEqual(["Alice", "Bob"]);
  });

  it("only lets one of two concurrent pool-consume calls succeed", async () => {
    vi.mocked(spotify.getPlaylistWithTracks)
      .mockResolvedValueOnce({ playlist: FAKE_PLAYLIST, tracks: [makeTrack({ id: "a" })] })
      .mockResolvedValueOnce({ playlist: FAKE_PLAYLIST, tracks: [makeTrack({ id: "b" })] });
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
