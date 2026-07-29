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
      // Uppercase so a code typed in lowercase reaches the same object. Without
      // this, "ab7k" and "AB7K" are two different rooms and the second player to
      // join lands somewhere empty.
      const code = match[1].toUpperCase();
      return env.BUZZER_ROOM.getByName(code).fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
