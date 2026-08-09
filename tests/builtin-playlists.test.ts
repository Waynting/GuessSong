import { describe, it, expect } from "vitest";
import {
  BUILTIN_PLAYLISTS,
  BUILTIN_PLAYLISTS_VERIFIED,
} from "@/lib/builtin-playlists";

describe("built-in playlists data", () => {
  it("ships at least 3 playlists", () => {
    expect(BUILTIN_PLAYLISTS.length).toBeGreaterThanOrEqual(3);
  });

  it("is preview-verified", () => {
    expect(BUILTIN_PLAYLISTS_VERIFIED).toBe(true);
  });

  it("has unique playlist ids", () => {
    const ids = BUILTIN_PLAYLISTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has playlist metadata (id, name, description, coverEmoji)", () => {
    for (const p of BUILTIN_PLAYLISTS) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.description).toBeTruthy();
      expect(p.coverEmoji).toBeTruthy();
    }
  });

  it("has 12-16 tracks per playlist (short trial sessions)", () => {
    for (const p of BUILTIN_PLAYLISTS) {
      expect(p.tracks.length).toBeGreaterThanOrEqual(12);
      expect(p.tracks.length).toBeLessThanOrEqual(16);
    }
  });

  it("every track has the required fields", () => {
    for (const p of BUILTIN_PLAYLISTS) {
      for (const t of p.tracks) {
        expect(t.id).toBeTruthy();
        expect(t.name).toBeTruthy();
        expect(Array.isArray(t.artists)).toBe(true);
        expect(t.artists.length).toBeGreaterThan(0);
        expect(t.artists[0]).toBeTruthy();
        expect(typeof t.durationMs).toBe("number");
        expect(t.durationMs).toBeGreaterThan(0);
        expect(t.albumImageUrl).toMatch(/^https:\/\//);
        expect(t.createdAt).toBeTruthy();
      }
    }
  });

  it("no track carries a rawJson blob (sessionStorage size guard)", () => {
    for (const p of BUILTIN_PLAYLISTS) {
      for (const t of p.tracks) {
        expect(t).not.toHaveProperty("rawJson");
      }
    }
  });

  it("track ids are unique across all playlists", () => {
    const ids = BUILTIN_PLAYLISTS.flatMap((p) => p.tracks.map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries no previewUrl field (clips are resolved via /api/preview)", () => {
    // Not merely null — the field is gone. Spotify's preview_url has returned
    // null for every track since Nov 2024, so baking it in was a permanently
    // empty column in every payload that carries a Track.
    for (const p of BUILTIN_PLAYLISTS) {
      for (const t of p.tracks) {
        expect(t).not.toHaveProperty("previewUrl");
      }
    }
  });
});
