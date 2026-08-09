#!/usr/bin/env node
/**
 * Prints the viral-loop counters. `npm run stats`.
 *
 * The counters written by `/r/[surface]` and `/api/pulse` are useless until
 * something reads them, and the thing that reads them cannot be a dashboard:
 * four separate attempts to go and open GA4 did not happen over eight weeks,
 * which makes "and then go look at it" a step with a measured completion rate
 * of zero rather than a step with a cost. A command in this repo is a
 * different proposition — it runs from the terminal that is already open, and
 * a coding agent can run it unprompted at the start of a session, which is the
 * actual delivery mechanism here.
 *
 * ## Keys are discovered, not reconstructed
 *
 * This script does not hold a copy of the metric list. It asks Redis for
 * everything under `loop:stats:` and parses what comes back. Rebuilding the
 * keys from a hardcoded list here would be a second definition of a format
 * that already lives in `lib/loop-stats.ts`, and that class of drift fails
 * silently — the script would read keys nobody writes and print a confident
 * table of zeros. Discovery also means a metric added later shows up here
 * without anyone remembering to update this file.
 *
 * The only shared knowledge is the `loop:stats:` prefix. If that ever changes
 * this prints "no counters found", which is loud rather than wrong.
 *
 * `KEYS` is the wrong tool on a large database. This namespace is a few
 * hundred keys with a 30-day TTL and the command runs by hand, so the usual
 * objection does not apply.
 *
 * Usage:
 *   export UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=...
 *   npm run stats            # last 7 complete days
 *   npm run stats -- 30      # last 30
 */

const PREFIX = "loop:stats:";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  console.error(
    "Missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.\n" +
      "These are the production values — the local fallback in lib/kv.ts is an\n" +
      "in-process Map, so there is nothing to read without them. Copy them from\n" +
      "the Vercel project's environment variables."
  );
  process.exit(1);
}

const days = Number.parseInt(process.argv[2] ?? "7", 10);
if (!Number.isInteger(days) || days < 1 || days > 30) {
  console.error("Day count must be 1-30 (counters are held 30 days).");
  process.exit(1);
}

/** One Upstash REST command. */
async function redis(command) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) {
    throw new Error(`Upstash ${res.status}: ${await res.text()}`);
  }
  const { result } = await res.json();
  return result;
}

/** UTC, matching `dayBucket()` in lib/kv.ts. */
function bucketsFor(count) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < count; i += 1) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function pct(numerator, denominator) {
  if (!denominator) return "     —";
  return `${((numerator / denominator) * 100).toFixed(1).padStart(5)}%`;
}

const keys = (await redis(["KEYS", `${PREFIX}*`])) ?? [];
if (keys.length === 0) {
  console.log(
    `No counters found under "${PREFIX}".\n\n` +
      "Either nothing has been recorded yet, or the key prefix in\n" +
      "lib/loop-stats.ts changed and this script was not updated."
  );
  process.exit(0);
}

const values = await redis(["MGET", ...keys]);
const window = new Set(bucketsFor(days));

/** metric -> total, and the set of days that recorded anything at all. */
const totals = new Map();
const liveDays = new Set();

keys.forEach((key, i) => {
  const rest = key.slice(PREFIX.length);
  const firstColon = rest.indexOf(":");
  if (firstColon === -1) return;
  const day = rest.slice(0, firstColon);
  const metric = rest.slice(firstColon + 1);
  if (!window.has(day)) return;

  const count = Number(values[i] ?? 0);
  if (!Number.isFinite(count)) return;
  if (metric === "live") {
    if (count > 0) liveDays.add(day);
    return;
  }
  totals.set(metric, (totals.get(metric) ?? 0) + count);
});

const get = (metric) => totals.get(metric) ?? 0;

const surfaces = [
  ...new Set(
    [...totals.keys()]
      .filter((m) => m.startsWith("impression:") || m.startsWith("click:"))
      .map((m) => m.slice(m.indexOf(":") + 1))
  ),
].sort();

const games = get("games");
const repeatHost = get("repeat_host");
const throttled = get("throttled");

console.log(`\nGuessSong loop — last ${days} days (UTC)`);
console.log(`Days with any activity: ${liveDays.size}/${days}\n`);

if (liveDays.size === 0) {
  console.log(
    "No day in this window recorded anything. That is a plumbing problem,\n" +
      "not a result — a real zero still bumps the liveness marker.\n"
  );
}

console.log("Surface            shown    followed     rate");
console.log("─".repeat(48));
if (surfaces.length === 0) {
  console.log("(nothing recorded)");
} else {
  for (const surface of surfaces) {
    const shown = get(`impression:${surface}`);
    const clicked = get(`click:${surface}`);
    console.log(
      `${surface.padEnd(18)}${String(shown).padStart(5)}` +
        `${String(clicked).padStart(12)}   ${pct(clicked, shown)}`
    );
  }
}

console.log(`\nGames started       ${games}`);
console.log(
  `Repeat hosts        ${repeatHost}   ${pct(repeatHost, games)} of games`
);

const indices = [...totals.keys()]
  .filter((m) => m.startsWith("host_index:"))
  .map((m) => Number(m.slice("host_index:".length)))
  .filter(Number.isFinite)
  .sort((a, b) => a - b);

if (indices.length > 0) {
  console.log("\nGames by host's game number");
  for (const n of indices) {
    const count = get(`host_index:${n}`);
    const bar = "█".repeat(Math.min(40, Math.round((count / games) * 40)));
    console.log(`  ${String(n).padStart(2)}${n === 10 ? "+" : " "} ${String(count).padStart(5)}  ${bar}`);
  }
}

if (throttled > 0) {
  console.log(
    `\n⚠  ${throttled} click(s) were dropped by the rate limiter and are NOT in\n` +
      "   the numbers above, so every rate here is understated by that much.\n" +
      "   A party is a dozen phones behind one IP, so this is expected rather\n" +
      "   than hostile."
  );
}

console.log(
  "\nRead these as floors, not measurements:\n" +
    "  · Repeat hosts are undercounted — iOS clears localStorage after 7 days\n" +
    "    idle, which is exactly the gap between two parties.\n" +
    "  · Followed counts miss anyone whose click never reached the server.\n" +
    "  · A low number can mean the CTA does not work, or that we could not see\n" +
    "    that it did. Only the direction over time is trustworthy.\n"
);
