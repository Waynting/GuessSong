/**
 * Talks to the Cloudflare Worker's HTTP surface. The room itself is created by
 * the Worker, not by Next.js, so the host token is minted on the side that
 * enforces it and there is no shared secret to keep in sync across two
 * platforms.
 */

import type { BuzzerRoomHandle } from "@/lib/game-session";
import { errorMessage, type AppErrorCode } from "@/lib/error-messages";

/**
 * Kept as its own class because components/room-panel.tsx buckets it separately
 * in analytics — "the Worker is down for everyone" is a different fact from
 * "this host did something wrong". Carries a code like every other error the
 * host can be shown; `message` is the English form, for logs.
 */
export class BuzzerUnavailableError extends Error {
  constructor(readonly code: AppErrorCode, detail?: string) {
    const english = errorMessage(code, "en");
    super(detail ? `${english} [${detail}]` : english);
    this.name = "BuzzerUnavailableError";
  }
}

/** True when the deployment is configured for Buzzer Mode at all. */
export function isBuzzerConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_BUZZER_WS_URL);
}

/**
 * The Worker is reached over ws:// for sockets and http:// for this one POST.
 * Deriving the HTTP origin from the socket URL keeps deployments to a single
 * env var instead of two that can drift apart.
 */
function httpOrigin(): string | null {
  const ws = process.env.NEXT_PUBLIC_BUZZER_WS_URL;
  if (!ws) return null;
  return ws.replace(/^ws/, "http").replace(/\/$/, "");
}

export async function createBuzzerRoom(): Promise<Omit<BuzzerRoomHandle, "hostName">> {
  const origin = httpOrigin();
  if (!origin) {
    throw new BuzzerUnavailableError(
      "buzzer_not_configured",
      "NEXT_PUBLIC_BUZZER_WS_URL is unset"
    );
  }

  const res = await fetch(`${origin}/rooms`, { method: "POST" });
  if (!res.ok) {
    if (res.status === 403) {
      throw new BuzzerUnavailableError(
        "buzzer_origin_blocked",
        "check ALLOWED_ORIGINS in worker/wrangler.jsonc"
      );
    }
    if (res.status === 429) {
      // Reachable by an ordinary host: changing Game Mode discards the open
      // room, so a few rounds of indecision burn through the per-IP budget.
      // Both translations of this code say what to do about it rather than
      // "please try again".
      throw new BuzzerUnavailableError("buzzer_rate_limited");
    }
    throw new BuzzerUnavailableError("buzzer_open_failed", `worker: ${res.status}`);
  }

  const data = (await res.json()) as { code?: unknown; hostToken?: unknown };
  if (typeof data.code !== "string" || typeof data.hostToken !== "string") {
    throw new BuzzerUnavailableError("buzzer_bad_response");
  }
  return { code: data.code, hostToken: data.hostToken };
}

/**
 * The URL players scan. Deliberately carries no host token.
 *
 * Built from `window.location.origin`, NOT `NEXT_PUBLIC_BASE_URL`: the player
 * has to land on the same deployment the host is running. That env var points
 * at production, so on a Vercel preview the QR code would send everyone to
 * www.guessong.app — a build where this room, and possibly the whole feature,
 * doesn't exist. Same reason Mixed Playlist Mode builds its `/j/` link from
 * `window.location.origin`.
 *
 * The env var stays as the non-browser fallback, which is only reachable if a
 * caller ever renders this during SSR.
 */
export function buzzerJoinUrl(code: string): string {
  const base =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_BASE_URL ?? "https://www.guessong.app";
  return `${base.replace(/\/$/, "")}/buzz/${code.toUpperCase()}`;
}
