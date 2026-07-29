import { BUZZER_CODE_ALPHABET, BUZZER_CODE_LENGTH } from "../../lib/buzzer-protocol";
import { BuzzerRoom, type Env } from "./buzzer-room";

// wrangler binds the Durable Object class from the entrypoint module, so this
// re-export is load-bearing, not tidiness.
export { BuzzerRoom };

/** How many fresh codes to try before admitting the space is congested. */
const MAX_CODE_ATTEMPTS = 8;

function generateCode(): string {
  const bytes = new Uint8Array(BUZZER_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const b of bytes) {
    code += BUZZER_CODE_ALPHABET[b % BUZZER_CODE_ALPHABET.length];
  }
  return code;
}

function allowedOrigins(env: Env): string[] {
  return env.ALLOWED_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Exact match, or a `*` glob for deploy targets whose hostname isn't knowable
 * ahead of time. Vercel mints a fresh preview domain per branch
 * (`<project>-git-<branch>-<team>.vercel.app`), so pinning exact origins would
 * mean redeploying this Worker for every branch anyone ever pushes.
 *
 * The glob is anchored at both ends and `*` never matches a `/`, so a pattern
 * like `https://guesssong-*.vercel.app` cannot be widened into
 * `https://guesssong-x.vercel.app.evil.com` by a crafted Origin header.
 */
function originMatches(origin: string, pattern: string): boolean {
  if (!pattern.includes("*")) return origin === pattern;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`).test(origin);
}

function isAllowedOrigin(origin: string | null, env: Env): boolean {
  if (!origin) return false;
  return allowedOrigins(env).some((p) => originMatches(origin, p));
}

/**
 * Browsers attach Origin to both `fetch` and the WebSocket upgrade, so this one
 * check keeps other sites off the room API. It is not a defence against a
 * non-browser client — nothing here is secret enough to need one — it just stops
 * a random page from opening rooms on a visitor's behalf.
 */
function originAllowed(request: Request, env: Env): boolean {
  return isAllowedOrigin(request.headers.get("Origin"), env);
}

/**
 * Per-IP throttle on the two public entry points.
 *
 * The Origin check above is the only thing that ever stood between a script and
 * the room API, and it is trivially satisfied by running that script on a page
 * this Worker already allows. That left the upgrade handler as an unmetered
 * oracle for "does this room code exist": a 4-character code from a
 * 31-character alphabet is ~923k combinations, so with a few live rooms an
 * unthrottled attacker walks the space in hours. Lengthening the code would
 * only have made that slower — metering the endpoint is what closes it, and it
 * closes the room-creation flood at the same time.
 *
 * `/rooms` is the stricter of the two: opening a room is a write, and a host
 * opens one per party. The upgrade is looser because a phone on a flaky network
 * legitimately reconnects with backoff, and the client gives up after three
 * never-opened attempts.
 *
 * Fails **open** when the binding is missing, which is the `wrangler dev`
 * and vitest case. A deploy without it is a config error, not a security
 * boundary quietly disappearing — the binding is declared in wrangler.jsonc and
 * ships with the Worker.
 */
async function rateLimited(request: Request, limiter: RateLimit | undefined): Promise<boolean> {
  if (!limiter) return false;
  // CF-Connecting-IP is set by Cloudflare's edge and cannot be spoofed by the
  // client — unlike X-Forwarded-For, which is why that one isn't used here.
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const { success } = await limiter.limit({ key: ip });
  return !success;
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  if (!isAllowedOrigin(origin, env)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // POST /rooms -> { code, hostToken, expiresAt }
    if (url.pathname === "/rooms" && request.method === "POST") {
      if (!originAllowed(request, env)) {
        return Response.json({ error: "Origin not allowed" }, { status: 403 });
      }
      if (await rateLimited(request, env.BUZZER_CREATE_LIMIT)) {
        return Response.json(
          { error: "Too many rooms opened, please slow down" },
          { status: 429, headers: cors }
        );
      }
      for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
        const code = generateCode();
        const claimed = await env.BUZZER_ROOM.getByName(code).claim(code);
        // claim() returns null when the code is already live, which is the only
        // collision check there is — the DO itself is the registry.
        if (claimed) {
          return Response.json(
            { code, hostToken: claimed.hostToken, expiresAt: claimed.expiresAt },
            { headers: cors }
          );
        }
      }
      return Response.json({ error: "Could not allocate a room code" }, { status: 503, headers: cors });
    }

    // GET /rooms/:code/ws -> WebSocket upgrade, routed to that room's object
    const match = url.pathname.match(/^\/rooms\/([A-Za-z0-9]{1,8})\/ws$/);
    if (match && request.method === "GET") {
      if (!originAllowed(request, env)) {
        return new Response("Origin not allowed", { status: 403 });
      }
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected websocket upgrade", { status: 426 });
      }
      // Before getByName(), so a code-guessing sweep can't instantiate a
      // Durable Object per guess on the way to being refused.
      if (await rateLimited(request, env.BUZZER_JOIN_LIMIT)) {
        return new Response("Too many attempts, please slow down", { status: 429 });
      }
      // Uppercase so a code typed in lowercase reaches the same object. Without
      // this, "ab7k" and "AB7K" are two different rooms and the second player to
      // join lands somewhere empty.
      const code = match[1].toUpperCase();
      return env.BUZZER_ROOM.getByName(code).fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
