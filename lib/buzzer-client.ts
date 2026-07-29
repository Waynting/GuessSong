/**
 * Talks to the Cloudflare Worker's HTTP surface. The room itself is created by
 * the Worker, not by Next.js, so the host token is minted on the side that
 * enforces it and there is no shared secret to keep in sync across two
 * platforms.
 */

import type { BuzzerRoomHandle } from "@/lib/game-session";

export class BuzzerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
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

export async function createBuzzerRoom(): Promise<BuzzerRoomHandle> {
  const origin = httpOrigin();
  if (!origin) {
    throw new BuzzerUnavailableError(
      "Buzzer Mode is not configured on this deployment (NEXT_PUBLIC_BUZZER_WS_URL is unset)"
    );
  }

  const res = await fetch(`${origin}/rooms`, { method: "POST" });
  if (!res.ok) {
    throw new BuzzerUnavailableError(
      res.status === 403
        ? "This origin is not allowed by the buzzer Worker — check ALLOWED_ORIGINS in worker/wrangler.jsonc"
        : "Couldn't open a buzzer room, please try again"
    );
  }

  const data = (await res.json()) as { code?: unknown; hostToken?: unknown };
  if (typeof data.code !== "string" || typeof data.hostToken !== "string") {
    throw new BuzzerUnavailableError("Buzzer Worker returned an unexpected response");
  }
  return { code: data.code, hostToken: data.hostToken };
}

/** The URL players scan. Deliberately carries no host token. */
export function buzzerJoinUrl(code: string): string {
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ??
    (typeof window !== "undefined" ? window.location.origin : "https://www.guessong.app");
  return `${base.replace(/\/$/, "")}/buzz/${code.toUpperCase()}`;
}
