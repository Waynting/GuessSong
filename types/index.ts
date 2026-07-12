export interface Track {
  id: string;
  name: string;
  artists: string[];
  durationMs: number;
  albumName?: string;
  albumImageUrl?: string;
  previewUrl?: string | null;
  rawJson?: Record<string, unknown>;
  createdAt: string;
  /** Mixed Playlist Mode: names of players whose playlist contained this track. */
  contributors?: string[];
  /** Spotify's 0-100 popularity score — used for the v2 "most mainstream" taste card award. */
  popularity?: number;
}
