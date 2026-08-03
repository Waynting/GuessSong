/**
 * The wire shape of a preview lookup, shared by both sides.
 *
 * Separate from lib/preview-cache.ts so the game page can import the contract
 * without importing the implementation — that module reaches for lib/kv.ts and
 * through it the Upstash client, none of which belongs in a browser bundle.
 * Same reason types/room.ts holds ROOM_TTL_SECONDS.
 */

/**
 * `absent` is a fact about the recording — nobody has a clip for it. Only a
 * clean, complete answer from upstream produces one, and it is cached for a
 * week.
 *
 * `unavailable` is a fact about *us*: throttled, out of budget, or the request
 * never got through. It is cached for ninety seconds and means "ask again",
 * which is the whole reason it is not spelled `absent`. Collapsing the two is
 * what marked a slice of the catalogue silent for a week every time iTunes
 * throttled our shared egress IP.
 */
export type PreviewStatus = "found" | "absent" | "unavailable";

export interface PreviewResult {
  previewUrl: string | null;
  status: PreviewStatus;
}

/** Worth remembering. An `unavailable` must never be cached as "no audio". */
export function isPreviewSettled(status: PreviewStatus): boolean {
  return status === "found" || status === "absent";
}

export interface PreviewBatchTrack {
  id: string;
  name: string;
  artist: string;
}

export interface PreviewBatchRequest {
  tracks: PreviewBatchTrack[];
}

export interface PreviewBatchResponse {
  previews: Record<string, PreviewResult>;
}

/**
 * Ceiling on one batch. A game plays at most 50 songs; the headroom covers a
 * host who asked for more. Enforced on the server and respected by the client,
 * which lets anything past it resolve lazily rather than sending a request it
 * knows will be refused.
 */
export const PREVIEW_BATCH_MAX = 60;
