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
}
