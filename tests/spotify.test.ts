import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The token cache lives at module scope, so every test re-imports lib/spotify
 * through vi.resetModules() to get a cache that starts cold. Sharing one
 * import across tests would let the first test's cached token silently
 * satisfy the rest, and they'd pass no matter what the code did.
 */

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const PLAYLIST_URL = "https://open.spotify.com/playlist/abc123";

interface RouteBehaviour {
  /** HTTP status for the playlist/tracks calls. 200 unless overridden. */
  playlistStatus?: number;
  /** Seconds reported by the token endpoint. */
  expiresIn?: number;
}

/**
 * Only the fields lib/spotify.ts actually reads. Annotating the mock's return
 * type explicitly is required: without it TS tries to infer one union from
 * every branch and hits circular inference on the async json/text members.
 */
interface MockResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

/**
 * Routes fetch by URL and counts token mints, which is the thing under test —
 * "did we go back to Spotify for a new token" is not observable any other way.
 */
function installFetchMock(behaviour: RouteBehaviour = {}) {
  const { playlistStatus = 200, expiresIn = 3600 } = behaviour;
  let tokenRequests = 0;
  let tokenSerial = 0;
  const bearersSeen: string[] = [];

  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<MockResponse> => {
    const href = typeof url === "string" ? url : url.toString();

    if (href === TOKEN_URL) {
      tokenRequests++;
      tokenSerial++;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ access_token: `token-${tokenSerial}`, expires_in: expiresIn }),
        text: async () => "",
      };
    }

    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    if (auth) bearersSeen.push(auth.replace("Bearer ", ""));

    if (playlistStatus !== 200) {
      return {
        ok: false,
        status: playlistStatus,
        statusText: "Error",
        json: async () => ({ error: { message: "nope" } }),
        text: async () => "nope",
      };
    }

    if (href.includes("/tracks")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ items: [], next: null }),
        text: async () => "",
      };
    }

    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ id: "abc123", name: "Test Playlist", tracks: { items: [], total: 0 } }),
      text: async () => "",
    };
  });

  vi.stubGlobal("fetch", fetchMock);
  return {
    tokenRequests: () => tokenRequests,
    bearersSeen: () => bearersSeen,
  };
}

async function freshSpotify() {
  vi.resetModules();
  return import("@/lib/spotify");
}

describe("Spotify client-credentials token cache", () => {
  beforeEach(() => {
    process.env.SPOTIFY_CLIENT_ID = "id";
    process.env.SPOTIFY_CLIENT_SECRET = "secret";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mints a token on the first playlist load", async () => {
    const probe = installFetchMock();
    const { getPlaylistWithTracks } = await freshSpotify();

    await getPlaylistWithTracks(PLAYLIST_URL);

    expect(probe.tokenRequests()).toBe(1);
  });

  it("reuses the cached token across playlist loads instead of re-minting", async () => {
    const probe = installFetchMock();
    const { getPlaylistWithTracks } = await freshSpotify();

    await getPlaylistWithTracks(PLAYLIST_URL);
    await getPlaylistWithTracks(PLAYLIST_URL);
    await getPlaylistWithTracks(PLAYLIST_URL);

    // Without the cache this would be 3 — one mint per load.
    expect(probe.tokenRequests()).toBe(1);
    expect(new Set(probe.bearersSeen())).toEqual(new Set(["token-1"]));
  });

  it("treats a token inside the expiry buffer as already expired", async () => {
    // expires_in equals the 60s safety buffer, so the usable lifetime is zero
    // and the second load must go back for a fresh token rather than hand out
    // one that could die mid-pagination.
    const probe = installFetchMock({ expiresIn: 60 });
    const { getPlaylistWithTracks } = await freshSpotify();

    await getPlaylistWithTracks(PLAYLIST_URL);
    await getPlaylistWithTracks(PLAYLIST_URL);

    expect(probe.tokenRequests()).toBe(2);
  });

  it("does not cache across module instances (guards the test isolation itself)", async () => {
    const first = installFetchMock();
    const a = await freshSpotify();
    await a.getPlaylistWithTracks(PLAYLIST_URL);
    expect(first.tokenRequests()).toBe(1);

    const second = installFetchMock();
    const b = await freshSpotify();
    await b.getPlaylistWithTracks(PLAYLIST_URL);
    expect(second.tokenRequests()).toBe(1);
  });
});

describe("Spotify token invalidation on 401", () => {
  beforeEach(() => {
    process.env.SPOTIFY_CLIENT_ID = "id";
    process.env.SPOTIFY_CLIENT_SECRET = "secret";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears the cache and retries once with a fresh token", async () => {
    // Critical gap from the eng review: a rejected token left in the cache
    // would be replayed by this instance until it expired on its own.
    const probe = installFetchMock({ playlistStatus: 401 });
    const { getPlaylistWithTracks } = await freshSpotify();

    await expect(getPlaylistWithTracks(PLAYLIST_URL)).rejects.toThrow();

    // Two mints: the original, plus one after the 401 invalidated it.
    expect(probe.tokenRequests()).toBe(2);
    expect(probe.bearersSeen()).toContain("token-1");
    expect(probe.bearersSeen()).toContain("token-2");
  });

  it("gives up after the single retry rather than looping forever", async () => {
    const probe = installFetchMock({ playlistStatus: 401 });
    const { getPlaylistWithTracks, SpotifyApiError } = await freshSpotify();

    await expect(getPlaylistWithTracks(PLAYLIST_URL)).rejects.toBeInstanceOf(SpotifyApiError);

    expect(probe.tokenRequests()).toBe(2);
  });

  it("does not retry or invalidate on a 404 — the playlist is simply unreachable", async () => {
    const probe = installFetchMock({ playlistStatus: 404 });
    const { getPlaylistWithTracks } = await freshSpotify();

    await expect(getPlaylistWithTracks(PLAYLIST_URL)).rejects.toThrow();

    expect(probe.tokenRequests()).toBe(1);
  });

  it("keeps a usable cached token when a later load 404s", async () => {
    const probe = installFetchMock();
    const { getPlaylistWithTracks } = await freshSpotify();
    await getPlaylistWithTracks(PLAYLIST_URL);

    // Same module instance, now failing with 404.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL): Promise<MockResponse> => {
        const href = typeof url === "string" ? url : url.toString();
        if (href === TOKEN_URL) throw new Error("should not re-mint on 404");
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: async () => ({ error: { message: "no" } }),
          text: async () => "no",
        };
      })
    );

    await expect(getPlaylistWithTracks(PLAYLIST_URL)).rejects.toThrow();
    expect(probe.tokenRequests()).toBe(1);
  });
});

describe("SpotifyApiError", () => {
  it("carries the upstream status so callers can distinguish 401 from 404", async () => {
    const { SpotifyApiError } = await freshSpotify();
    const err = new SpotifyApiError("boom", 401);

    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(401);
    expect(err.message).toBe("boom");
  });
});
