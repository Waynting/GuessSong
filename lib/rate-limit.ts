/**
 * Fixed-window rate limiting on top of lib/kv.ts's atomic incr. Not exact
 * (a client can burst up to 2x limit across a window boundary) but cheap
 * and good enough to blunt code-guessing/spam against the room endpoints —
 * see lib/room.ts's 4-char code space.
 */

import { getKvStore } from "@/lib/kv";
import { errorResponse } from "@/lib/api-error";
import type { AppErrorCode } from "@/lib/error-messages";
import type { NextResponse, NextRequest } from "next/server";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

/**
 * A KV failure here is logged, but one line per request is not useful when the
 * cause is an exhausted monthly quota: every request fails, so the log becomes
 * one repeated sentence at full traffic and the interesting lines around it
 * scroll away. Report at most once a minute per instance instead — enough for
 * the condition to be visible, few enough to read.
 */
const FAILURE_LOG_INTERVAL_MS = 60 * 1000;
let lastFailureLoggedAt = 0;

function reportStoreFailure(identifier: string, err: unknown): void {
  const now = Date.now();
  if (now - lastFailureLoggedAt < FAILURE_LOG_INTERVAL_MS) return;
  lastFailureLoggedAt = now;
  console.error(
    "[rate-limit] KV unavailable, failing open:",
    identifier,
    err instanceof Error ? err.message : err
  );
}

/**
 * Fails **open**: if the KV store cannot be reached the request is allowed.
 *
 * This is the same rule the caches and the global budgets already follow —
 * losing the safety net must mean "back to how it was", not "nobody can play".
 * It is easy to read a rate limiter as the one place where failing *closed* is
 * the safe default, and that reading is what took the whole site down: this
 * runs at the top of all seven API routes, before their own try/catch, so an
 * `incr` that threw escaped the handler entirely and Next answered with a bare
 * 500 and an empty body. Playlist loading, previews and rooms all stopped at
 * once, and the client had no `code` to render, so hosts were told the generic
 * "couldn't load the playlist" about playlists that were perfectly fine.
 *
 * The trigger was Upstash's monthly request cap (500k on the free plan) being
 * spent, which fails every command until the quota rolls over — an outage
 * measured in days, not the seconds a blip would cost.
 *
 * Failing open gives up the per-IP ceiling for the duration, which is the
 * cheaper half of the trade in both directions: the limits exist mainly to
 * blunt code-guessing against lib/room.ts's 4-char code space, and rooms live
 * in the same KV that is already unreachable — an unthrottled guesser has
 * nothing to read. Spotify and iTunes stay protected either way, because their
 * ceilings are enforced separately in lib/playlist-cache.ts and
 * lib/preview-cache.ts, which fail open to *their own* upstream limits rather
 * than to none.
 */
export async function rateLimit(
  identifier: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  try {
    const store = await getKvStore();
    const count = await store.incr(`ratelimit:${identifier}`, windowSeconds);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  } catch (err) {
    reportStoreFailure(identifier, err);
    return { allowed: true, remaining: limit };
  }
}

/** Best-effort client IP from proxy headers; falls back to a shared bucket. */
export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Route guard: resolves the caller's IP, counts the request against
 * `bucket:<ip>`, and returns a ready-to-return 429 when the window is spent.
 *
 *   const limited = await enforceRateLimit(req, "room:create", LIMIT, WINDOW, "rate_limited");
 *   if (limited) return limited;
 *
 * Returning the response rather than throwing keeps the guard visible at the
 * top of each handler — the check and the early return sit on adjacent lines
 * instead of being hidden in a catch. Every route must run this before any
 * expensive work (upstream fetch, KV read, playlist pagination).
 *
 * `code` rather than a sentence: the phones that hit these limits are the ones
 * scanning a QR into someone else's room, and they read the refusal in their
 * own language. See lib/error-messages.ts.
 */
export async function enforceRateLimit(
  req: NextRequest,
  bucket: string,
  limit: number,
  windowSeconds: number,
  code: AppErrorCode
): Promise<NextResponse | null> {
  const ip = getClientIp(req);
  const { allowed } = await rateLimit(`${bucket}:${ip}`, limit, windowSeconds);
  if (allowed) return null;
  return errorResponse(code, 429);
}
