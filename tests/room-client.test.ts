import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildRoster, openRoom, roomJoinUrl, type OpenRoom } from "@/lib/room-client";

const BUZZER: OpenRoom["buzzer"] = {
  code: "AB7K",
  hostToken: "secret-host-token",
  hostName: "Wayn",
};

describe("roomJoinUrl", () => {
  it("sends a buzzer room to /buzz on the host's own deployment", () => {
    // Never NEXT_PUBLIC_BASE_URL: on a Vercel preview that would print a QR
    // pointing at production, where this room doesn't exist.
    process.env.NEXT_PUBLIC_BASE_URL = "https://www.guessong.app";
    const room: OpenRoom = { code: "AB7K", collectsPlaylists: false, buzzer: BUZZER };
    expect(roomJoinUrl(room)).toBe(`${window.location.origin}/buzz/AB7K`);
  });

  it("flags a buzzer room that also wants playlists, so the form asks for one", () => {
    const room: OpenRoom = {
      code: "AB7K",
      collectsPlaylists: true,
      playlistHostToken: "t",
      buzzer: BUZZER,
    };
    expect(roomJoinUrl(room)).toBe(`${window.location.origin}/buzz/AB7K?p=1`);
  });

  it("sends a playlist-only room to /j, which has no socket to hold", () => {
    const room: OpenRoom = { code: "AB7K", collectsPlaylists: true, playlistHostToken: "t" };
    expect(roomJoinUrl(room)).toBe(`${window.location.origin}/j/AB7K`);
  });

  it("carries no host token, in either shape", () => {
    const both: OpenRoom = {
      code: "AB7K",
      collectsPlaylists: true,
      playlistHostToken: "secret-playlist-token",
      buzzer: BUZZER,
    };
    expect(roomJoinUrl(both)).not.toMatch(/token|secret/i);
    expect(roomJoinUrl({ code: "AB7K", collectsPlaylists: true, playlistHostToken: "s" })).not.toMatch(
      /token|secret/i
    );
  });
});

describe("openRoom", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    process.env.NEXT_PUBLIC_BUZZER_WS_URL = "wss://buzzer.example.workers.dev";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(body: unknown, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  }

  it("claims the Durable Object BEFORE reserving the mailbox", async () => {
    // The whole reason one shared code is safe. The Worker hands its host token
    // to whoever POSTs a code first, so if the mailbox (whose code every player
    // sees) came first, any guest could take over the buzzers.
    const calls: string[] = [];
    fetchMock.mockImplementation(async (url: string) => {
      calls.push(String(url));
      if (String(url).endsWith("/rooms")) {
        return jsonResponse({ code: "AB7K", hostToken: "host-1" });
      }
      return jsonResponse({ roomCode: "AB7K", hostToken: "playlist-1", expiresAt: 0 });
    });

    const room = await openRoom({ collectsPlaylists: true, buzzer: true, hostName: "Wayn" });

    expect(calls).toEqual(["https://buzzer.example.workers.dev/rooms", "/api/room"]);
    expect(room.code).toBe("AB7K");
    expect(room.buzzer).toEqual({ code: "AB7K", hostToken: "host-1", hostName: "Wayn" });
    expect(room.playlistHostToken).toBe("playlist-1");
  });

  it("hands the claimed code to the mailbox, so both halves share one code", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/rooms")) {
        return jsonResponse({ code: "CD8M", hostToken: "host-1" });
      }
      expect(JSON.parse(String(init?.body))).toEqual({ code: "CD8M" });
      return jsonResponse({ roomCode: "CD8M", hostToken: "playlist-1", expiresAt: 0 });
    });

    const room = await openRoom({ collectsPlaylists: true, buzzer: true, hostName: "Wayn" });
    expect(room.code).toBe("CD8M");
    expect(room.buzzer?.code).toBe("CD8M");
  });

  it("claims a fresh code when the first one is already a live mailbox", async () => {
    const claimed = ["AB7K", "CD8M"];
    let attempt = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/rooms")) {
        return jsonResponse({ code: claimed[attempt++], hostToken: `host-${attempt}` });
      }
      return attempt === 1
        ? jsonResponse({ error: "That room code is already in use" }, 409)
        : jsonResponse({ roomCode: "CD8M", hostToken: "playlist-2", expiresAt: 0 });
    });

    const room = await openRoom({ collectsPlaylists: true, buzzer: true, hostName: "Wayn" });
    // Never joins the stranger's mailbox under AB7K.
    expect(room.code).toBe("CD8M");
  });

  it("opens only the Durable Object when nothing collects playlists", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: "AB7K", hostToken: "host-1" }));
    const room = await openRoom({ collectsPlaylists: false, buzzer: true, hostName: "Wayn" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(room.collectsPlaylists).toBe(false);
    expect(room.playlistHostToken).toBeUndefined();
  });

  it("opens only the mailbox when the buzzer is off, and asks for no code", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe("/api/room");
      expect(JSON.parse(String(init?.body))).toEqual({});
      return jsonResponse({ roomCode: "EF9N", hostToken: "playlist-1", expiresAt: 0 });
    });
    const room = await openRoom({ collectsPlaylists: true, buzzer: false, hostName: "Wayn" });
    expect(room.code).toBe("EF9N");
    expect(room.buzzer).toBeUndefined();
  });

  it("refuses to open a room with no job — that's the pass-the-phone case", async () => {
    await expect(
      openRoom({ collectsPlaylists: false, buzzer: false, hostName: "Wayn" })
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("buildRoster", () => {
  it("marks a joined phone that hasn't added a playlist yet", () => {
    const roster = buildRoster(
      [{ name: "Amy", connected: true }],
      [],
      true,
      true
    );
    expect(roster).toEqual([{ name: "Amy", live: true, trackCount: undefined }]);
  });

  it("decorates a joined phone with its submitted track count", () => {
    const roster = buildRoster(
      [{ name: "Amy", connected: true }],
      [{ playerName: "amy", trackCount: 42 }],
      true,
      true
    );
    // Case-insensitive: the buzzer room refuses a second "amy" while "Amy" is
    // connected, so these are one human, not two rows.
    expect(roster).toEqual([{ name: "Amy", live: true, trackCount: 42 }]);
  });

  it("keeps a submitter whose phone has since dropped off the socket", () => {
    const roster = buildRoster(
      [{ name: "Amy", connected: true }],
      [
        { playerName: "Amy", trackCount: 10 },
        { playerName: "Ben", trackCount: 7 },
      ],
      true,
      true
    );
    expect(roster.map((r) => r.name)).toEqual(["Amy", "Ben"]);
    expect(roster[1].live).toBeUndefined();
  });

  it("reports no track counts when the room doesn't collect playlists", () => {
    const roster = buildRoster([{ name: "Amy", connected: false }], [], false, true);
    expect(roster).toEqual([{ name: "Amy", live: false }]);
  });

  it("falls back to submissions alone when there is no buzzer half", () => {
    const roster = buildRoster([], [{ playerName: "Amy", trackCount: 3 }], true, false);
    expect(roster).toEqual([{ name: "Amy", trackCount: 3 }]);
  });
});
