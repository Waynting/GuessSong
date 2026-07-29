import { Track } from "@/types";

const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";

/** Carries the HTTP status alongside the message so callers can react to 401 vs 404. */
export class SpotifyApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "SpotifyApiError";
  }
}

/**
 * Client-credentials tokens live for an hour, but every call used to mint a
 * fresh one — doubling upstream requests on the hottest path.
 *
 * Cached at module scope, which on Vercel means per lambda instance rather
 * than globally. A shared Upstash cache would cut token requests further but
 * was rejected deliberately: /api/playlist currently has zero KV dependency,
 * and routing it through Upstash would mean a KV outage takes down playlist
 * loading entirely. Warm-instance savings are worth more than the remainder.
 */
let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * Shaved off the reported lifetime so a token that is seconds from expiring
 * is never handed to a caller that is about to make several paginated
 * requests with it.
 */
const TOKEN_EXPIRY_BUFFER_SECONDS = 60;

/**
 * Drop the cached token. MUST be called whenever Spotify rejects it (401):
 * without this, a single revoked or clock-skewed token keeps getting replayed
 * by this instance until it expires on its own — up to an hour of every
 * playlist request failing while other instances are fine.
 */
function invalidateClientAccessToken(): void {
  cachedToken = null;
}

/**
 * Get access token using Client Credentials Flow (for public playlists)
 * This doesn't require user authentication
 */
async function getClientAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.value;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Spotify Client ID and Secret must be set");
  }

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    console.error("Spotify token error:", response.status, errorText);
    // Leave the cache untouched on failure — an existing (possibly still
    // valid) entry is more useful than clearing it because a refresh blipped.
    throw new SpotifyApiError(
      `Failed to get access token: ${response.status} ${errorText}`,
      response.status
    );
  }

  const data = await response.json();
  // Spotify reports expires_in in seconds; fall back to the documented 1h
  // default if it's ever missing so we never cache with a NaN expiry.
  const lifetimeSeconds =
    typeof data.expires_in === "number" ? data.expires_in : 3600;
  cachedToken = {
    value: data.access_token,
    expiresAt:
      Date.now() + Math.max(0, lifetimeSeconds - TOKEN_EXPIRY_BUFFER_SECONDS) * 1000,
  };
  return cachedToken.value;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: Array<{ name: string }>;
  duration_ms: number;
  preview_url: string | null; // 30-second preview URL
  popularity?: number; // 0-100, used by the Mixed Playlist Mode taste card
  album: {
    name: string;
    images: Array<{ url: string }>;
  };
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  owner?: {
    id: string;
    display_name?: string;
  };
  tracks: {
    items: Array<{
      track: SpotifyTrack | null;
    }>;
    total: number;
  };
}

/**
 * Check if playlist ID is a Spotify editorial/algorithm playlist
 * Spotify editorial playlists have IDs starting with "37i9"
 * These playlists return 404 for new/development apps after Nov 2024
 */
export function isSpotifyEditorial(playlistId: string): boolean {
  return playlistId.startsWith("37i9");
}

/**
 * Parse Spotify playlist URL to extract playlist ID
 */
export function parsePlaylistUrl(url: string): string | null {
  // Support formats:
  // https://open.spotify.com/playlist/{id}
  // spotify:playlist:{id}
  const patterns = [
    /playlist\/([a-zA-Z0-9]+)/,
    /spotify:playlist:([a-zA-Z0-9]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Fetch playlist data from Spotify API
 * Requires user access token for user's own playlists
 */
export async function fetchPlaylist(
  playlistId: string,
  accessToken: string
): Promise<SpotifyPlaylist> {
  const response = await fetch(`${SPOTIFY_API_BASE}/playlists/${playlistId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }));
    console.error("Spotify playlist fetch error:", response.status, errorData);
    
    if (response.status === 404) {
      throw new SpotifyApiError("無法找到此歌單。請確認：1) 歌單是公開的 2) 歌單是你自己建立的（不是 Spotify 編輯歌單）", 404);
    }

    throw new SpotifyApiError(`Failed to fetch playlist: ${response.status} - ${errorData.error?.message || response.statusText}. Make sure the playlist is public.`, response.status);
  }

  return response.json();
}

/**
 * Fetch all tracks from a playlist (handles pagination)
 * Requires user access token for user's own playlists
 */
export async function fetchPlaylistTracks(
  playlistId: string,
  accessToken: string
): Promise<SpotifyTrack[]> {
  const tracks: SpotifyTrack[] = [];
  // Don't specify market when using user token - let Spotify use user's country
  let url = `${SPOTIFY_API_BASE}/playlists/${playlistId}/tracks?limit=50`;

  while (url) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }));
      console.error("Spotify tracks fetch error:", response.status, errorData, "URL:", url);
      
      if (response.status === 404) {
        throw new SpotifyApiError("無法找到此歌單。請確認：1) 歌單是公開的 2) 歌單是你自己建立的（不是 Spotify 編輯歌單）", 404);
      }

      throw new SpotifyApiError(`Failed to fetch tracks: ${response.status} - ${errorData.error?.message || response.statusText}. Make sure the playlist is public and accessible.`, response.status);
    }

    const data = await response.json();
    const validTracks = data.items
      .map((item: { track: SpotifyTrack | null }) => item.track)
      .filter((track: SpotifyTrack | null): track is SpotifyTrack => track !== null);

    tracks.push(...validTracks);

    url = data.next || null;
  }

  return tracks;
}

/**
 * Convert Spotify track to our Track format
 */
export function convertSpotifyTrack(spotifyTrack: SpotifyTrack): Track {
  return {
    id: spotifyTrack.id,
    name: spotifyTrack.name,
    artists: spotifyTrack.artists.map((artist) => artist.name),
    durationMs: spotifyTrack.duration_ms,
    albumName: spotifyTrack.album.name,
    albumImageUrl: spotifyTrack.album.images[0]?.url,
    previewUrl: spotifyTrack.preview_url || null, // Store preview URL
    popularity: spotifyTrack.popularity,
    rawJson: spotifyTrack as unknown as Record<string, unknown>,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Get full playlist info including tracks using Client Credentials (no user login required)
 */
export async function getPlaylistWithTracks(
  playlistUrl: string
): Promise<{ playlist: SpotifyPlaylist; tracks: Track[] }> {
  const playlistId = parsePlaylistUrl(playlistUrl);
  if (!playlistId) {
    throw new Error("Invalid playlist URL");
  }

  if (isSpotifyEditorial(playlistId)) {
    throw new Error("Spotify editorial/algorithm playlists are not supported. Please use a public playlist you created.");
  }

  // Two attempts: a cached token can be rejected mid-flight (revoked, clock
  // skew, or expiring between the buffer check and Spotify's own clock). That
  // is transparently recoverable, so drop the bad entry and mint a fresh one
  // rather than surfacing an error the user can do nothing about. Only 401
  // retries — a 404 means the playlist genuinely isn't reachable.
  for (let attempt = 0; ; attempt++) {
    const token = await getClientAccessToken();

    try {
      const [playlist, spotifyTracks] = await Promise.all([
        fetchPlaylist(playlistId, token),
        fetchPlaylistTracks(playlistId, token),
      ]);

      const tracks = spotifyTracks.map(convertSpotifyTrack);

      return { playlist, tracks };
    } catch (err) {
      const isAuthFailure = err instanceof SpotifyApiError && err.status === 401;
      if (!isAuthFailure) throw err;

      invalidateClientAccessToken();
      if (attempt > 0) throw err;
    }
  }
}


