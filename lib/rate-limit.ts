/**
 * Fixed-window rate limiting on top of lib/kv.ts's atomic incr. Not exact
 * (a client can burst up to 2x limit across a window boundary) but cheap
 * and good enough to blunt code-guessing/spam against the room endpoints —
 * see lib/room.ts's 4-char code space.
 */

import { getKvStore } from "@/lib/kv";
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
