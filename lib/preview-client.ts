/**
 * Browser half of the preview lookup.
 *
 * Deliberately free of any server import — lib/preview-cache.ts pulls in
 * lib/kv.ts and the Upstash client, none of which belongs in the bundle a phone
 * downloads. The contract both halves share lives in types/preview.ts.
 *
 * Every failure here resolves to `unavailable`, never `absent`. A dropped
 * request is the client-side twin of the throttled-upstream bug this whole
 * change is about: the page cannot tell "there is no clip for this song" from
 * "the network ate the question", and only one of those is worth remembering.
 */

import {
  PREVIEW_BATCH_MAX,
  type PreviewBatchRequest,
  type PreviewBatchResponse,
  type PreviewBatchTrack,
  type PreviewResult,
} from "@/types/preview";

const UNAVAILABLE: PreviewResult = { previewUrl: null, status: "unavailable" };

/**
 * A body with a URL but no `status` is a server older than this page. It had
 * only two outcomes, so its null means what its `absent` would have — reading
 * it as `unavailable` instead would put the page into an endless retry against
 * a deploy that is never going to answer differently.
 */
function toResult(body: unknown): PreviewResult {
  const data = (body ?? {}) as Partial<PreviewResult>;
  const previewUrl = typeof data.previewUrl === "string" ? data.previewUrl : null;
  if (data.status === "found" || data.status === "absent" || data.status === "unavailable") {
    return { previewUrl, status: data.status };
  }
  return { previewUrl, status: previewUrl ? "found" : "absent" };
}

export interface FetchPreviewOptions {
  /**
   * Re-resolve a URL that failed to play. Preview URLs sit on a CDN that
   * rotates them, so a cached hit can go dead long before it expires; this is
   * the repair path that lets the server hold them as long as it does.
   */
  refresh?: boolean;
}

export async function fetchPreview(
  track: PreviewBatchTrack,
  options: FetchPreviewOptions = {}
): Promise<PreviewResult> {
  const params = new URLSearchParams({
    track: track.name,
    artist: track.artist,
    // id keys the server-side cache: the same recording shows up under
    // different name/artist strings across playlists, which would otherwise
    // fragment the cache and re-hit iTunes for a track we already know.
    id: track.id,
  });
  if (options.refresh) params.set("refresh", "1");

  try {
    const res = await fetch(`/api/preview?${params.toString()}`);
    // A 429 has no preview in it, and it is emphatically not "this song has no
    // audio" — it is the one answer that most needs asking again later.
    if (!res.ok) return UNAVAILABLE;
    return toResult(await res.json());
  } catch {
    return UNAVAILABLE;
  }
}

/**
 * Resolves a whole game's previews up front.
 *
 * Best-effort by design: the caller keeps whatever comes back and falls through
 * to `fetchPreview` for the rest, which is exactly what the page did before
 * this route existed. Tracks past PREVIEW_BATCH_MAX are not sent at all — the
 * server would refuse the request outright, taking the tracks that would have
 * fitted down with it.
 */
export async function fetchPreviewBatch(
  tracks: PreviewBatchTrack[]
): Promise<Map<string, PreviewResult>> {
  const results = new Map<string, PreviewResult>();
  const payload = tracks.slice(0, PREVIEW_BATCH_MAX);
  if (payload.length === 0) return results;

  try {
    const res = await fetch("/api/preview/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tracks: payload } satisfies PreviewBatchRequest),
    });
    if (!res.ok) return results;
    const body = (await res.json()) as Partial<PreviewBatchResponse>;
    for (const [id, result] of Object.entries(body?.previews ?? {})) {
      results.set(id, toResult(result));
    }
  } catch {
    // Leave the map empty. Every track then takes the lazy path, which is
    // slower but complete — a failed prefetch must not become a failed game.
  }
  return results;
}
