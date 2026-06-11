import { describe, it, expect } from "vitest";
import {
  buildGamePayload,
  parseGamePayload,
  stripTrackForStorage,
  GAME_STORAGE_KEY,
} from "@/lib/game-session";
import type { Track } from "@/types";

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: "t1",
    name: "Song",
    artists: ["Artist"],
    durationMs: 200000,
    albumName: "Album",
    albumImageUrl: "https://img.example/a.jpg",
    previewUrl: null,
    rawJson: { huge: "blob", nested: { stuff: [1, 2, 3] } },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("GAME_STORAGE_KEY", () => {
  it("stays backward compatible with the existing key", () => {
    expect(GAME_STORAGE_KEY).toBe("guesssong_game");
  });
});

describe("stripTrackForStorage", () => {
  it("removes rawJson and keeps everything else", () => {
    const stripped = stripTrackForStorage(makeTrack());
    expect(stripped).not.toHaveProperty("rawJson");
    expect(stripped.id).toBe("t1");
    expect(stripped.name).toBe("Song");
    expect(stripped.artists).toEqual(["Artist"]);
    expect(stripped.albumImageUrl).toBe("https://img.example/a.jpg");
  });
});

describe("buildGamePayload", () => {
  it("builds an own/party payload with rawJson stripped from every track", () => {
    const payload = buildGamePayload({
      tracks: [makeTrack({ id: "a" }), makeTrack({ id: "b" })],
      players: [
        { name: "Alice", score: 0 },
        { name: "Bob", score: 0 },
      ],
      playlistName: "My Mix",
      clipDuration: 10,
      totalTracks: 2,
      playlistSource: "own",
      mode: "party",
    });

    expect(payload.playlistSource).toBe("own");
    expect(payload.mode).toBe("party");
    expect(payload.playlistName).toBe("My Mix");
    expect(payload.clipDuration).toBe(10);
    expect(payload.totalTracks).toBe(2);
    expect(payload.players).toHaveLength(2);
    expect(payload.tracks).toHaveLength(2);
    for (const t of payload.tracks) {
      expect(t).not.toHaveProperty("rawJson");
    }
    // never persists a playableTracks field (removed legacy field)
    expect(payload).not.toHaveProperty("playableTracks");
  });

  it("builds a builtin/trial payload and defaults totalTracks to tracks.length", () => {
    const payload = buildGamePayload({
      tracks: [makeTrack({ id: "a" }), makeTrack({ id: "b" }), makeTrack({ id: "c" })],
      players: [{ name: "You", score: 0 }],
      playlistName: "Western Classics",
      clipDuration: 15,
      playlistSource: "builtin",
      mode: "trial",
    });

    expect(payload.playlistSource).toBe("builtin");
    expect(payload.mode).toBe("trial");
    expect(payload.totalTracks).toBe(3);
    expect(payload.players).toEqual([{ name: "You", score: 0 }]);
  });

  it("round-trips through JSON + parseGamePayload unchanged", () => {
    const payload = buildGamePayload({
      tracks: [makeTrack()],
      players: [{ name: "You", score: 0 }],
      playlistName: "Mix",
      clipDuration: 5,
      playlistSource: "builtin",
      mode: "trial",
    });
    const parsed = parseGamePayload(JSON.stringify(payload));
    expect(parsed).toEqual(payload);
  });
});

describe("parseGamePayload", () => {
  it("applies defaults for old payloads without mode/playlistSource", () => {
    const legacy = JSON.stringify({
      tracks: [makeTrack()],
      players: [{ name: "Alice", score: 3 }],
      playlistName: "Old Mix",
      clipDuration: 20,
      totalTracks: 1,
      playableTracks: undefined, // legacy field, ignored
    });

    const parsed = parseGamePayload(legacy);
    expect(parsed).not.toBeNull();
    expect(parsed!.playlistSource).toBe("own");
    expect(parsed!.mode).toBe("party");
    expect(parsed!.playlistName).toBe("Old Mix");
    expect(parsed!.clipDuration).toBe(20);
    expect(parsed!.tracks).toHaveLength(1);
  });

  it("defaults missing fields on a minimal payload", () => {
    const parsed = parseGamePayload(JSON.stringify({ tracks: [] }));
    expect(parsed).not.toBeNull();
    expect(parsed!.players).toEqual([]);
    expect(parsed!.playlistName).toBe("");
    expect(parsed!.clipDuration).toBe(15);
    expect(parsed!.totalTracks).toBe(0);
    expect(parsed!.playlistSource).toBe("own");
    expect(parsed!.mode).toBe("party");
  });

  it("parses explicit builtin/trial fields", () => {
    const parsed = parseGamePayload(
      JSON.stringify({ tracks: [], playlistSource: "builtin", mode: "trial" })
    );
    expect(parsed!.playlistSource).toBe("builtin");
    expect(parsed!.mode).toBe("trial");
  });

  it("falls back to defaults for unknown enum values", () => {
    const parsed = parseGamePayload(
      JSON.stringify({ tracks: [], playlistSource: "weird", mode: "nope" })
    );
    expect(parsed!.playlistSource).toBe("own");
    expect(parsed!.mode).toBe("party");
  });

  it("returns null for invalid JSON", () => {
    expect(parseGamePayload("not json {")).toBeNull();
  });

  it("returns null for non-object JSON", () => {
    expect(parseGamePayload("42")).toBeNull();
    expect(parseGamePayload("null")).toBeNull();
  });
});
