/**
 * Fixed-window rate limiting on top of lib/kv.ts's atomic incr. Not exact
 * (a client can burst up to 2x limit across a window boundary) but cheap
 * and good enough to blunt code-guessing/spam against the room endpoints —
 * see lib/room.ts's 4-char code space.
 */

import { getKvStore } from "@/lib/kv";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

export async function rateLimit(
  identifier: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const store = await getKvStore();
  const count = await store.incr(`ratelimit:${identifier}`, windowSeconds);
  return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
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
 *   const limited = await enforceRateLimit(req, "room:create", LIMIT, WINDOW, "…");
 *   if (limited) return limited;
 *
 * Returning the response rather than throwing keeps the guard visible at the
 * top of each handler — the check and the early return sit on adjacent lines
 * instead of being hidden in a catch. Every route must run this before any
 * expensive work (upstream fetch, KV read, playlist pagination).
 */
export async function enforceRateLimit(
  req: NextRequest,
  bucket: string,
  limit: number,
  windowSeconds: number,
  message: string
): Promise<NextResponse | null> {
  const ip = getClientIp(req);
  const { allowed } = await rateLimit(`${bucket}:${ip}`, limit, windowSeconds);
  if (allowed) return null;
  return NextResponse.json({ error: message }, { status: 429 });
}
