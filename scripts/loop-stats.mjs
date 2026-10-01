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
 * without anyone remembering to update this file — though only as far as the
 * renderers go, which is what the "Other counters" block at the bottom is for.
 *
 * The only shared knowledge is the `loop:stats:` prefix. If that ever changes
 * this prints "no counters found", which is loud rather than wrong.
 *
 * **Discovery uses `SCAN`, not `KEYS`, and that is not a style preference.**
 * `KEYS` matches against every key in the instance rather than every key under
 * the prefix, so this namespace's size was never the relevant number:
 * `lib/preview-cache.ts` writes one key per track and holds positive entries
 * for a year, and when that set crossed Upstash's ceiling the server began
 * refusing the command outright. `npm run stats` then exits 1 and prints
 * nothing, for a reason with no connection to the loop. Anything that walks
 * this namespace must page a cursor.
 *
 * Usage:
 *   npm run stats            # last 7 complete days
 *   npm run stats -- 30      # last 30
 *
 * Credentials come from `.env.local` or `.env` (both gitignored), or from the
 * environment if you would rather export them.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PREFIX = "loop:stats:";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Same files Next reads, so there is one place to keep these.
 *
 * `process.loadEnvFile` is a Node built-in (20.12+) — no dotenv, which would be
 * a dependency added purely to read a file the runtime already parses.
 *
 * **Order is inverted on purpose.** It does not overwrite a variable that is
 * already set, so first writer wins; loading `.env.local` first is what gives
 * it precedence over `.env`, matching Next. Anything exported in the shell was
 * set before either call and still beats both.
 */
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(join(repoRoot, file));
  } catch {
    // Absent, or unreadable. Either is fine — the check below is the one that
    // decides whether we actually have what we need.
  }
}

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  console.error(
    "Missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.\n" +
      "Looked in .env.local, .env, and the environment.\n\n" +
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

/**
 * One Upstash REST command.
 *
 * Failures are rewritten before they surface. The raw ones are an undici
 * `TypeError: fetch failed` with a stack into Node internals, which says
 * nothing about the two things actually likely to be wrong here — a typo'd URL
 * or a token from the wrong project.
 */
async function redis(command) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    });
  } catch (cause) {
    throw new Error(
      `Could not reach Upstash at ${url}\n` +
        `  ${cause instanceof Error ? cause.message : String(cause)}\n` +
        "  Check UPSTASH_REDIS_REST_URL — it should be the full https:// REST\n" +
        "  endpoint from the Vercel project, not the redis:// connection string."
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      "Upstash rejected the token.\n" +
        "  UPSTASH_REDIS_REST_TOKEN does not match UPSTASH_REDIS_REST_URL —\n" +
        "  usually a token copied from a different database."
    );
  }
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

/**
 * Every key under the prefix, walked with `SCAN` rather than `KEYS`.
 *
 * `KEYS` was correct about this namespace and wrong about the database. The
 * loop counters are a few hundred keys with a 30-day TTL — but `KEYS` matches
 * against *every* key in the instance, and `lib/preview-cache.ts` writes one
 * per track and holds positive entries for a year. That set grows with the
 * catalogue, not with the loop, and when it crossed Upstash's ceiling the
 * server started refusing the command outright:
 *
 *     ERR KEYS command is disabled because total number of keys is too large
 *
 * The failure mode is what makes this worth the extra code. It is not a slow
 * report or a partial one: `npm run stats` exits 1 and prints nothing, and it
 * does so for a reason that has nothing to do with the loop. The one instrument
 * anybody actually reads went dark because a different namespace grew.
 *
 * `SCAN` is O(1) per call and cursor-paged, so it never trips that ceiling.
 * `MATCH` is applied server-side but *after* the per-call sample, so a page may
 * legitimately come back empty while the cursor is still non-zero — stopping on
 * an empty page instead of on cursor 0 is the classic way to read a fraction of
 * a namespace and report it as the whole thing. `COUNT` is a hint, not a limit.
 */
async function scanKeys(match) {
  const found = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis(["SCAN", cursor, "MATCH", match, "COUNT", "1000"]);
    cursor = String(next);
    if (Array.isArray(batch)) found.push(...batch);
  } while (cursor !== "0");
  return found;
}

let keys;
try {
  keys = await scanKeys(`${PREFIX}*`);
} catch (err) {
  console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
if (keys.length === 0) {
  console.log(
    `No counters found under "${PREFIX}".\n\n` +
      "Either nothing has been recorded yet, or the key prefix in\n" +
      "lib/loop-stats.ts changed and this script was not updated."
  );
  process.exit(0);
}

/**
 * Chunked because the REST transport puts the whole command in one request, so
 * a single `MGET` over the namespace grows a request body without bound. 30
 * days times the metric count is already a few hundred keys and the metric
 * count only goes up.
 */
async function mgetAll(wanted) {
  const out = [];
  for (let i = 0; i < wanted.length; i += 256) {
    out.push(...((await redis(["MGET", ...wanted.slice(i, i + 256)])) ?? []));
  }
  return out;
}

const values = await mgetAll(keys);
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

/**
 * How the playlist got into the field, for the games that said.
 *
 * `host_setup:<source>` rides on the same beacon as `Games started` and is
 * written by `recordGameStart` in lib/loop-stats.ts. The setup form began
 * remembering the last game on a device because more than half of all games
 * come from a host who has played before and every one of them was retyping
 * an empty form; this line is whether that memory gets used.
 *
 * Reading it: `restored` and `recent` are a returning host who did not
 * retype, and the second line is their share of the games that had a single
 * link at all. Put it beside `Repeat hosts` — a repeat host who still
 * `typed` is one whose storage was evicted (iOS, seven idle days), or who
 * wanted a different playlist tonight, and the two cannot be told apart from
 * here. `starter` is zero until lib/starter-playlists.ts has a list.
 *
 * The denominator is the games that *said*, not `Games started`: a page
 * loaded before this shipped sends no source and is counted above exactly
 * as it always was. So the six sum to at most `games`, and in a window that
 * straddles the deploy the gap is old tabs, not a seventh source. Floors,
 * like the line they hang off.
 *
 * The order mirrors `SETUP_SOURCES` — an .mjs has no path to a TypeScript
 * constant — and only orders: a source this list does not know still prints,
 * after the ones it does.
 */
const SETUP_SOURCE_ORDER = ["typed", "restored", "recent", "starter", "shared", "mixed"];
const setupSources = [...totals.keys()]
  .filter((m) => m.startsWith("host_setup:"))
  .map((m) => m.slice("host_setup:".length))
  .sort((a, b) => {
    const [ia, ib] = [SETUP_SOURCE_ORDER.indexOf(a), SETUP_SOURCE_ORDER.indexOf(b)];
    return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib) || a.localeCompare(b);
  });
const setupSaid = setupSources.reduce((t, s) => t + get(`host_setup:${s}`), 0);

if (setupSaid > 0) {
  const parts = setupSources.map((s) => `${s} ${get(`host_setup:${s}`)}`).join(" · ");
  const remembered = get("host_setup:restored") + get("host_setup:recent");
  // Over the games that had a link to remember. A mixed game has none, so
  // leaving it in the denominator would read the memory as less used the
  // more Mixed is played.
  const withLink = setupSaid - get("host_setup:mixed");
  console.log(`Playlist came from  ${parts}   (${setupSaid} of ${games} games said)`);
  console.log(
    `                    ${pct(remembered, withLink).trim()} of single-playlist games started on a link the form ` +
      "remembered (restored + recent) — read it beside Repeat hosts"
  );
}

/**
 * Where the games went. `Games started` is a beacon from the setup page;
 * these two are beacons from the Game Over screen, so the difference is the
 * tab that closed mid-party — and the Game Over screen is where every
 * host-side loop surface lives, so that difference is the share of games
 * the loop never had a chance at. It was five thousand of six in the week
 * this was added, and nothing in KV could say so.
 *
 * Three floors and a subtraction: a lost end beacon reads as a closed tab,
 * a lost start beacon makes the gap read smaller, and neither can make it
 * read as zero. Direction, not level. The round histogram is early ends
 * only — round one or two is a game that could not play, round fifteen is
 * a room that had enough — capped where the round stops being a question
 * (`GAME_ROUND_CEILING` in lib/loop-stats.ts, mirrored here for the label).
 */
const GAME_ROUND_CEILING = 20;
const playedOut = get("game_end:played_out");
const endedEarly = get("game_end:ended_early");
const reachedEnd = playedOut + endedEarly;

/**
 * The games that did not reach Game Over and said so: `game_left_round:<n>`,
 * a beacon from the game page's `pagehide` (and from its unmount, which is
 * what the back gesture is). Until it existed the line under `Reached Game
 * Over` called the whole remainder "closed the tab", which was a name for
 * what nothing had counted. Now the remainder is only what sent neither
 * beacon, and the line says so.
 *
 * Not a partition of `games`, and the subtraction can go negative: a reload
 * is a leave *and* a game that may still reach Game Over, with one start
 * between them. A window that begins before the leave beacon shipped has
 * starts in it that could not have sent one, so the remainder reads high
 * there; it is a direction, like the gap it replaced.
 */
const leftRounds = [...totals.keys()]
  .filter((m) => m.startsWith("game_left_round:"))
  .map((m) => Number(m.slice("game_left_round:".length)))
  .filter(Number.isFinite)
  .sort((a, b) => a - b);
const leftMidGame = leftRounds.reduce((t, n) => t + get(`game_left_round:${n}`), 0);

if (reachedEnd > 0) {
  console.log(
    `Reached Game Over   ${reachedEnd}   ${pct(reachedEnd, games)} of games — ` +
      `${playedOut} played out · ${endedEarly} ended early`
  );
  if (leftMidGame > 0) {
    const unaccounted = games - reachedEnd - leftMidGame;
    console.log(
      `Left mid-game       ${leftMidGame}   ${pct(leftMidGame, games)} of games — ` +
        "the page was closed, reloaded or navigated away before Game Over"
    );
    if (unaccounted > 0) {
      console.log(
        `                    the other ${unaccounted} sent neither beacon: a tab the phone killed, ` +
          "a beacon that was lost, or a game from before the leave beacon shipped"
      );
    } else if (unaccounted < 0) {
      console.log(
        `                    ${-unaccounted} more ends and leaves than starts: a reloaded game ` +
          "leaves once and can still reach Game Over"
      );
    }
  } else if (games > reachedEnd) {
    console.log(
      `                    the other ${games - reachedEnd} closed the tab mid-game ` +
        "(a floor: a lost beacon lands here too)"
    );
  }
}

const screenPhone = get("game_end_screen:phone");
const screenDesktop = get("game_end_screen:desktop");
if (screenPhone + screenDesktop > 0) {
  console.log(
    `                    Game Over was drawn on a phone ${screenPhone} times ` +
      `(${pct(screenPhone, screenPhone + screenDesktop).trim()}) and on a desktop ${screenDesktop}`
  );
}

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

const earlyRounds = [...totals.keys()]
  .filter((m) => m.startsWith("game_end_round:"))
  .map((m) => Number(m.slice("game_end_round:".length)))
  .filter(Number.isFinite)
  .sort((a, b) => a - b);

/**
 * Row 0 is not a round. It is End Game (or a leave) before any clip had
 * started, which the page has always reported as 0 and which was clamped up
 * into row 1 until 2026-09-30 — so a window that straddles that date has
 * some of its zeros in row 1. Labelled on the row itself, because a bare
 * "0" at the top of a histogram of rounds reads as one.
 */
const ROUND_ZERO_NOTE = "  ← no clip had started";

if (earlyRounds.length > 0 && endedEarly > 0) {
  console.log("\nEnded early at round");
  for (const n of earlyRounds) {
    const count = get(`game_end_round:${n}`);
    const bar = "█".repeat(Math.min(40, Math.round((count / endedEarly) * 40)));
    console.log(
      `  ${String(n).padStart(2)}${n === GAME_ROUND_CEILING ? "+" : " "} ${String(count).padStart(5)}  ${bar}` +
        (n === 0 ? ROUND_ZERO_NOTE : "")
    );
  }
  console.log(
    "  how to read it: a pile at 0–2 is a game that could not play; a spread through\n" +
      "  the teens is a room that had enough. Row 0 never heard a clip at all."
  );
}

if (leftRounds.length > 0 && leftMidGame > 0) {
  console.log("\nLeft mid-game at round");
  for (const n of leftRounds) {
    const count = get(`game_left_round:${n}`);
    const bar = "█".repeat(Math.min(40, Math.round((count / leftMidGame) * 40)));
    console.log(
      `  ${String(n).padStart(2)}${n === GAME_ROUND_CEILING ? "+" : " "} ${String(count).padStart(5)}  ${bar}` +
        (n === 0 ? ROUND_ZERO_NOTE : "")
    );
  }
  console.log(
    "  how to read it: same rows as the histogram above, for the hosts who left without\n" +
      "  pressing End Game. Once per game — a reload counts where it happened, and the\n" +
      "  restarted game sends no second leave."
  );
}

/**
 * The two histograms above, crossed with whether the device had hosted
 * before — `game_end_host:<kind>:<end>`, `game_end_early:<kind>:<band>` and
 * `game_left_host:<kind>:<band>`, the kind riding on the end and leave
 * beacons. The question it answers is which audience the pile at rounds 0–2
 * is: people trying the site once, or hosts who came back and whose game
 * broke. Banded, because kind × exact round is sixty-three keys a day.
 *
 * `first` is a ceiling and `repeat` a floor, for the reason the repeat-host
 * figure is one: iOS evicts the count after seven idle days, so a returning
 * host can read as a first. `unknown` is a page that asked and was refused.
 * Kinds and bands mirror GAME_HOST_KINDS / EARLY_END_BANDS in
 * lib/loop-stats.ts; tests/loop-stats.test.ts holds the two together.
 */
const hostKinds = ["first", "repeat", "unknown"];
const earlyBands = [
  ["r0", "no clip started"],
  ["r1_2", "rounds 1–2"],
  ["r3_plus", "round 3 or later"],
];
const byHost = (prefix, tail) => hostKinds.map((k) => get(`${prefix}:${k}:${tail}`));
const hostRow = (label, counts) =>
  `  ${label.padEnd(26)}${counts.map((c) => String(c).padStart(9)).join("")}`;
const hostPlayedOut = byHost("game_end_host", "played_out");
const hostEndedEarly = byHost("game_end_host", "ended_early");
const hostLeft = hostKinds.map((k) =>
  earlyBands.reduce((t, [band]) => t + get(`game_left_host:${k}:${band}`), 0)
);

if ([...hostPlayedOut, ...hostEndedEarly, ...hostLeft].some((c) => c > 0)) {
  console.log("\nHow games ended, by whether the device had hosted before");
  console.log(hostRow("", hostKinds));
  console.log(hostRow("played out", hostPlayedOut));
  console.log(hostRow("ended early", hostEndedEarly));
  for (const [band, label] of earlyBands) {
    console.log(hostRow(`  ${label}`, byHost("game_end_early", band)));
  }
  console.log(hostRow("left mid-game", hostLeft));
  for (const [band, label] of earlyBands) {
    console.log(hostRow(`  ${label}`, byHost("game_left_host", band)));
  }
  console.log(
    "  how to read it: compare the 0–2 rows across the first two columns. Heavier under\n" +
      "  `first` is people trying the site; heavier under `repeat` is a game that broke\n" +
      "  for someone who knew how it should go."
  );
}

/**
 * The first Play press of each game: `first_clip:<path>:<outcome>`.
 *
 * The hypothesis it was built to test is in the two `rejected` cells. On the
 * lazy path the page has to look the clip up before it can play it, so
 * `play()` runs after an await — outside the tap — and a browser may refuse
 * it; round one is when the prefetch is least likely to have landed. Rates
 * are per path, because the paths are different sizes and the comparison is
 * between them. Paths and outcomes mirror FIRST_CLIP_PATHS /
 * FIRST_CLIP_OUTCOMES in lib/loop-stats.ts.
 */
const clipPaths = ["prefetched", "lazy"];
const clipOutcomes = [
  ["played", "played"],
  ["rejected", "refused by the browser"],
  ["no_audio", "no clip anywhere"],
  ["unavailable", "we could not answer"],
  ["error", "would not load"],
  ["abandoned", "host moved on first"],
];
const clipTotals = clipPaths.map((p) =>
  clipOutcomes.reduce((t, [o]) => t + get(`first_clip:${p}:${o}`), 0)
);
const firstClips = clipTotals.reduce((t, c) => t + c, 0);

if (firstClips > 0) {
  console.log("\nFirst clip of the game");
  console.log(`  ${"".padEnd(26)}${clipPaths.map((p) => p.padStart(18)).join("")}`);
  for (const [outcome, label] of clipOutcomes) {
    const cells = clipPaths.map((p, i) => {
      const count = get(`first_clip:${p}:${outcome}`);
      return `${String(count).padStart(9)}  ${pct(count, clipTotals[i])}`;
    });
    console.log(`  ${label.padEnd(26)}${cells.join("")}`);
  }
  console.log(
    `  ${firstClips} games had Play pressed, ${pct(firstClips, games).trim()} of games started`
  );
  console.log(
    "  how to read it: `refused` much higher under lazy than under prefetched is the\n" +
      "  autoplay policy catching a play() that ran outside the tap. If the two rates are\n" +
      "  level, that is not what is ending games at round one."
  );
}

/**
 * What a host who reached Game Over tapped next: `game_over_tap:<target>`.
 * `play_again` is against every Game Over; `mixed` is the link phones get in
 * place of the QR, so it is against the phone screens only.
 */
const tapAgain = get("game_over_tap:play_again");
const tapMixed = get("game_over_tap:mixed");
if (tapAgain + tapMixed > 0) {
  console.log(
    `\nTapped on Game Over  Play Again ${tapAgain} (${pct(tapAgain, reachedEnd).trim()} of Game Overs)` +
      ` · Mixed link ${tapMixed} (${pct(tapMixed, screenPhone).trim()} of phone Game Overs)`
  );
  console.log(
    "  how to read it: the Mixed link is where the QR used to be on a phone, so its rate\n" +
      "  is the one to set beside the game_over row above."
  );
}

/**
 * The setup page's nudge toward Mixed mode (`lib/mixed-nudge.ts`), shown once
 * a host has typed three names. `started` is a Mixed game begun after a tap.
 */
const nudgeShown = get("mixed_nudge:shown");
const nudgeTapped = get("mixed_nudge:tapped");
const nudgeStarted = get("mixed_nudge:started");
if (nudgeShown + nudgeTapped + nudgeStarted > 0) {
  console.log(
    `\nMixed nudge on setup  shown ${nudgeShown} · tapped ${nudgeTapped} (${pct(nudgeTapped, nudgeShown).trim()})` +
      ` · started a Mixed game ${nudgeStarted} (${pct(nudgeStarted, nudgeTapped).trim()} of taps)`
  );
  console.log(
    "  how to read it: shown counts page loads where three names were typed, not hosts.\n" +
      "  A tap that does not start is a host who looked at Mixed and went back; set\n" +
      "  started beside `Playlist came from … mixed` to see what share of Mixed it brought."
  );
}

/**
 * The playlist quiz funnel: created → opened → started → completed → board,
 * then the share surface's own row above. Each stage is a server-side count
 * (the route that did the thing bumps it), so unlike the surface table
 * nothing here is lost to a page tearing down; only a spent rate-limit
 * window can drop one — and those are counted too, per route, in the
 * "refused" line.
 *
 * Reading it: opens per quiz below 1 means owners are not sending the link —
 * a share-step problem, not a quiz problem. started ÷ opened is the intro
 * (a friend who read the card and left); completed ÷ started is the quiz
 * itself — below about 40% the default is too long, and the length table is
 * what says *which* lengths. `started` is dated: it is the first question's
 * check, which shipped with the per-question reveal, so a window straddling
 * that deploy reads low against opens. board ÷ created is the owner coming
 * back for the results. The verdict spread is the difficulty gauge: a pile
 * at "soulmate" means the decoys are too easy to spot, and that is the
 * trigger for spending an upstream call on better ones.
 *
 * The hint line is the quiz's only per-question upstream path. `heard per
 * completed` next to the allowance says whether the ration holds;
 * `unavailable` is the quiz spending a throttled minute; `repaired` is the
 * year-long positive cache rotting under it.
 *
 * Four rows were added on 2026-09-30, for the step the funnel could not see
 * into — a quiz made and never sent. `from` is who makes quizzes. `owner
 * opened` / `owner played` are the maker on their own link, which until then
 * were inside opened, started, completed, the verdicts and the length table;
 * they are counted *instead of* those now, so every friend-side row stepped
 * down that day and a window across it is two series. `… copy` is the Copy
 * link button, which until then was filed as a share's `copied`. And `board
 * share` is the results page's share button, which until then reached GA4
 * alone. `opened` also stopped counting the result screen's Refresh.
 */
const quizCreated = get("quiz:created");
const quizOpened = get("quiz:opened");
const quizStarted = get("quiz:started");
const quizCompleted = get("quiz:completed");
const quizBoard = get("quiz:board");
// Under the `quiz:` prefix, which the fallback at the bottom treats as
// rendered: without these two reads and their rows the counters move in KV
// and no line here moves with them.
const quizOwnerOpened = get("quiz:owner_opened");
const quizOwnerCompleted = get("quiz:owner_completed");
// Every tap on a quiz's share or Copy button in the window. In the guard
// below so that a day whose only quiz activity is an owner coming back to
// send a link made earlier still prints the block — the panel is drawn for a
// remembered quiz now, so that day exists.
const quizTaps = [...totals]
  .filter(
    ([m]) => m.startsWith("quiz_share:") || m.startsWith("quiz_copy:") || m.startsWith("quiz_social:")
  )
  .reduce((t, [, c]) => t + c, 0);
const verdicts = [...totals.keys()]
  .filter((m) => m.startsWith("quiz_verdict:"))
  .map((m) => m.slice("quiz_verdict:".length))
  .sort();

/**
 * Mirrors `QUIZ_QUESTION_COUNTS` / `QUIZ_DEFAULT_QUESTION_COUNT` in
 * types/quiz.ts, for the same reason the cache kinds below mirror theirs:
 * this is an .mjs with no path to a TypeScript constant, and the set is small
 * and closed. It only annotates — a wrong mirror mislabels a row as "typed",
 * it never changes a number.
 */
const QUIZ_PRESETS = new Set([10, 20, 30, 50]);
const QUIZ_DEFAULT = 10;

/** `quiz_len:<stage>:<n>` → { n: count } for one stage. */
function lengthsFor(stage) {
  const out = new Map();
  for (const [metric, count] of totals) {
    const prefix = `quiz_len:${stage}:`;
    if (!metric.startsWith(prefix)) continue;
    const n = Number(metric.slice(prefix.length));
    if (Number.isInteger(n)) out.set(n, count);
  }
  return out;
}

if (quizCreated + quizOpened + quizStarted + quizCompleted + quizBoard + quizOwnerOpened + quizOwnerCompleted + quizTaps > 0) {
  console.log("\nPlaylist quiz — the link-shaped surface");

  const locales = [...totals.keys()]
    .filter((m) => m.startsWith("quiz_locale:"))
    .map((m) => m.slice("quiz_locale:".length))
    .sort()
    .map((l) => `${l} ${get(`quiz_locale:${l}`)}`)
    .join(" · ");
  console.log(
    `  created     ${String(quizCreated).padStart(6)}${locales ? `   ${locales}` : ""}`
  );

  // Who makes quizzes. `quiz_from:<source>` is written with `created` when
  // the page named a source, so the row's total is at most `created` and the
  // difference is quizzes made by a page from before 2026-09-30 (or by
  // something that is not the page). Discovered by prefix, biggest first: a
  // loop surface added later prints under its own name with no edit here.
  const sources = [...totals.keys()]
    .filter((m) => m.startsWith("quiz_from:"))
    .map((m) => m.slice("quiz_from:".length))
    .sort((a, b) => get(`quiz_from:${b}`) - get(`quiz_from:${a}`) || a.localeCompare(b));
  if (sources.length > 0) {
    const named = sources.reduce((t, s) => t + get(`quiz_from:${s}`), 0);
    console.log(
      `  from        ${String(named).padStart(6)}   ${sources.map((s) => `${s} ${get(`quiz_from:${s}`)}`).join(" · ")}`
    );
    console.log(
      "                       where the maker came from: a surface name followed one of our links, internal is\n" +
        "                       this site, external someone else's, none no referrer (typed, bookmarked, installed)"
    );
    if (quizCreated > named) {
      console.log(
        `                       ${quizCreated - named} of ${quizCreated} quizzes named no source — made by a page from before this was sent`
      );
    }
  }

  console.log(
    `  opened      ${String(quizOpened).padStart(6)}   ${(quizCreated ? quizOpened / quizCreated : 0).toFixed(1)} per quiz`
  );

  // The maker on their own link, recognised by the host token and counted
  // here *instead of* in opened, started, completed, the verdicts and the
  // length table. Floors: the token is in the creating browser's storage, so
  // the same person on another device is a friend in the rows around these.
  if (quizOwnerOpened + quizOwnerCompleted > 0) {
    console.log(
      `  owner opened${String(quizOwnerOpened).padStart(6)}   ${pct(quizOwnerOpened, quizCreated)} of quizzes had their maker open the link — a preview, not in opened`
    );
    console.log(
      `  owner played${String(quizOwnerCompleted).padStart(6)}   ${pct(quizOwnerCompleted, quizOwnerOpened)} of those previews were played to the end — graded, never on the board`
    );
  }

  // The step between the two lines above. `quiz_share:<by>:<outcome>` is
  // every tap on a share button and what the sheet said, so `owner` against
  // `created` is a ceiling (one owner sending twice is two) — but the
  // outcome split is the reading: many `dismissed` is a sheet nobody
  // finishes, `shared` with few opens is a link sent to nobody, and no taps
  // at all is a panel the owner never got to. Printed only once recorded,
  // and each `by` on its own line.
  const shareOutcomes = ["shared", "copied", "dismissed", "failed"];
  // What each `by` is read against: the panel against quizzes made, the
  // result screen against sheets finished, the results page against the
  // times it was opened. All three are taps over a count, so ceilings.
  const tapsAgainst = (by, taps) =>
    by === "owner"
      ? `${pct(taps, quizCreated)} of quizzes`
      : by === "board"
        ? `${pct(taps, quizBoard)} of board opens`
        : `${pct(taps, quizCompleted)} of finishes`;
  for (const by of ["owner", "taker", "board"]) {
    const counts = shareOutcomes.map((o) => get(`quiz_share:${by}:${o}`));
    const taps = counts.reduce((t, c) => t + c, 0);
    if (taps === 0) continue;
    const parts = shareOutcomes.map((o, i) => `${o} ${counts[i]}`).join(" · ");
    const against = tapsAgainst(by, taps);
    console.log(`  ${`${by} share`.padEnd(12)}${String(taps).padStart(6)}   ${against} tapped it — ${parts}`);
  }

  // The Copy link button, on its own key since 2026-09-30
  // (`quiz_copy:<by>:<copied|failed>`). Read it beside the share row above
  // it: together they are everyone who tried to send the link, and a quiz
  // with neither is one its maker never tried to send.
  const copyOutcomes = ["copied", "failed"];
  let copyTaps = 0;
  for (const by of ["owner", "taker", "board"]) {
    const counts = copyOutcomes.map((o) => get(`quiz_copy:${by}:${o}`));
    const taps = counts.reduce((t, c) => t + c, 0);
    if (taps === 0) continue;
    copyTaps += taps;
    const parts = copyOutcomes.map((o, i) => `${o} ${counts[i]}`).join(" · ");
    console.log(`  ${`${by} copy`.padEnd(12)}${String(taps).padStart(6)}   ${tapsAgainst(by, taps)} tapped Copy link — ${parts}`);
  }
  if (quizTaps > 0) {
    console.log(
      "                       on a share row, copied is the share button with no share sheet to open; a tap on\n" +
        "                       Copy link is the copy row" +
        (copyTaps > 0 ? "" : " (none yet)") +
        ". Days before 2026-09-30 filed both as a share's copied"
    );
  }

  // The post-to-a-platform links (`quiz_social:<by>:<platform>`), drawn only
  // on a browser with no share sheet — so the population that ever saw them
  // is the share row's `copied`, not its total, and a row here is read
  // against that as much as against the denominator printed. A tap opens the
  // platform's composer in a new tab; whether anything was posted is opened.
  // Platforms mirror SOCIAL_PLATFORMS in lib/social-share.ts.
  const socialPlatforms = ["line", "threads", "x", "facebook", "whatsapp"];
  let socialTaps = 0;
  for (const by of ["owner", "taker", "board"]) {
    const counts = socialPlatforms.map((p) => get(`quiz_social:${by}:${p}`));
    const taps = counts.reduce((t, c) => t + c, 0);
    if (taps === 0) continue;
    socialTaps += taps;
    const parts = socialPlatforms
      .map((p, i) => [p, counts[i]])
      .filter(([, c]) => c > 0)
      .map(([p, c]) => `${p} ${c}`)
      .join(" · ");
    const sheetless = get(`quiz_share:${by}:copied`);
    console.log(
      `  ${`${by} social`.padEnd(12)}${String(taps).padStart(6)}   ${tapsAgainst(by, taps)} posted to a platform — ${parts}` +
        (sheetless > 0 ? ` (${sheetless} share taps had no sheet)` : "")
    );
  }
  if (quizTaps > 0 && socialTaps === 0) {
    console.log("  social           0   no LINE / Threads / X / Facebook / WhatsApp link tapped (shown only without a share sheet)");
  }
  console.log(`  started     ${String(quizStarted).padStart(6)}   ${pct(quizStarted, quizOpened)} of opens answered a question`);
  console.log(
    `  completed   ${String(quizCompleted).padStart(6)}   ${pct(quizCompleted, quizOpened)} of opens · ${pct(quizCompleted, quizStarted)} of starts`
  );
  console.log(
    `  board       ${String(quizBoard).padStart(6)}   ${pct(quizBoard, quizCreated)} of quizzes had the owner back for results`
  );
  if (verdicts.length > 0) {
    const most = Math.max(...verdicts.map((v) => get(`quiz_verdict:${v}`)));
    for (const v of verdicts) {
      const count = get(`quiz_verdict:${v}`);
      const bar = "█".repeat(Math.min(30, Math.round((count / most) * 30)));
      console.log(`    ${v.padEnd(13)}${String(count).padStart(5)}  ${bar}`);
    }
  }

  // Length: what hosts chose, and how many friends finished a quiz of each
  // length. `finishers ÷ quizzes` is two floors over each other and needs no
  // `opened`, which is a ceiling. A row that exists only on the `completed`
  // side is a quiz made before this window and finished inside it.
  const made = lengthsFor("created");
  const done = lengthsFor("completed");
  const lengths = [...new Set([...made.keys(), ...done.keys()])].sort((a, b) => a - b);
  if (lengths.length > 0) {
    console.log("\n  questions   quizzes  finishers  per quiz");
    for (const n of lengths) {
      const q = made.get(n) ?? 0;
      const f = done.get(n) ?? 0;
      const tag = n === QUIZ_DEFAULT ? "default" : QUIZ_PRESETS.has(n) ? "preset" : "typed";
      console.log(
        `  ${String(n).padStart(4)} ${tag.padEnd(8)}${String(q).padStart(6)}${String(f).padStart(11)}` +
          `${q ? (f / q).toFixed(1).padStart(10) : "         —"}`
      );
    }
    const clamped = get("quiz_clamped");
    if (clamped > 0) {
      console.log(
        `  ${clamped} of ${quizCreated} quizzes were built shorter than the host asked for — ` +
          "the playlist had fewer usable tracks, and the panel does not say so"
      );
    }
  }

  // Hints. `absent` costs nothing upstream (a cached fact about the
  // recording); `unavailable` is the quiz paying for a throttled minute.
  const hintFound = get("quiz_hint:found");
  const hintAbsent = get("quiz_hint:absent");
  const hintUnavailable = get("quiz_hint:unavailable");
  const hintRefresh = get("quiz_hint:refresh");
  if (hintFound + hintAbsent + hintUnavailable + hintRefresh > 0) {
    // The allowance is one per ten questions, so the comparison needs the
    // lengths of the quizzes that were finished, not a flat number.
    let allowance = 0;
    for (const [n, count] of done) allowance += Math.max(1, Math.round(n / 10)) * count;
    console.log(
      `\n  hints       heard ${hintFound} · no clip ${hintAbsent} · unavailable ${hintUnavailable} · repaired ${hintRefresh}`
    );
    if (quizCompleted > 0) {
      console.log(
        `              ${(hintFound / quizCompleted).toFixed(1)} heard per completed quiz, ` +
          `against an allowance of ${(allowance / quizCompleted).toFixed(1)}`
      );
    }
  }

  const refused = [...totals.keys()]
    .filter((m) => m.startsWith("quiz_throttled:"))
    .map((m) => m.slice("quiz_throttled:".length))
    .sort();
  if (refused.length > 0) {
    const parts = refused.map((r) => `${r} ${get(`quiz_throttled:${r}`)}`).join(", ");
    console.log(
      `\n  ⚠  refused by the limiter: ${parts}. Each is a request the funnel above\n` +
        "     never saw — an answer refused is a friend who finished and was\n" +
        "     turned away, which reads as a low completion rate."
    );
  }

  console.log("  the CTA on the result screen is the quiz_result row above");
}

/**
 * Anything discovered under `loop:stats:` that no block above consumed.
 *
 * `KEYS` finds every metric, but every renderer above is written against one
 * specific key shape, so until this existed a newly added counter was read,
 * summed, and then silently dropped — and the header of this file promised the
 * opposite ("a metric added later appears here without anyone editing the
 * script"). It was true of the discovery and false of the output, which is the
 * worst place for that split: the number looks like a zero rather than like a
 * missing renderer, and zero is a real answer here.
 *
 * Printing the leftovers generically costs a few lines and closes the class.
 * A metric that deserves better framing than a raw count gets its own block
 * above and drops out of this one by being consumed.
 */
const RENDERED_EXACT = new Set(["live", "games", "repeat_host", "throttled", "quiz_clamped"]);
const RENDERED_PREFIXES = [
  "impression:",
  "click:",
  "host_index:",
  "host_setup:",
  "game_end:",
  "game_end_round:",
  "game_end_host:",
  "game_end_early:",
  "game_end_screen:",
  "game_left_round:",
  "game_left_host:",
  "first_clip:",
  "game_over_tap:",
  "mixed_nudge:",
  "refusal_recovery:",
  "refusal_recovery_via:",
  "playlist_refused:",
  "playlist_invalid:",
  "playlist_shortlink:",
  "quiz:",
  "quiz_share:",
  "quiz_copy:",
  "quiz_social:",
  "quiz_from:",
  "quiz_verdict:",
  "quiz_len:",
  "quiz_locale:",
  "quiz_hint:",
  "quiz_throttled:",
];

const leftovers = [...totals.keys()]
  .filter(
    (m) =>
      !RENDERED_EXACT.has(m) && !RENDERED_PREFIXES.some((p) => m.startsWith(p))
  )
  .sort();

if (leftovers.length > 0) {
  console.log("\nOther counters");
  for (const metric of leftovers) {
    console.log(`  ${metric.padEnd(24)}${String(get(metric)).padStart(6)}`);
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

/**
 * Upstream cache health — the other half of "can this keep running".
 *
 * The loop counters say whether the product spreads. These say whether it can
 * afford to. Every playlist miss is a call against Spotify's quota, which is
 * per *app* rather than per visitor, and every preview miss is up to five
 * against iTunes and Deezer, which throttle a serverless deploy's shared
 * egress IPs as one very noisy client. Neither budget grows with the audience.
 *
 * They are printed here for the reason in this file's header. On 2026-08-23
 * Spotify cut the whole app off for fourteen hours — `retry-after: 52531`,
 * `reason: QUOTA_EXCEEDED` — and the playlist hit rate had been sitting at 26%
 * for days beforehand, because a 6h TTL aged out faster than parties recur.
 * `getCacheStats()` had that number the entire time. Nothing called it, so the
 * first anyone knew was the outage.
 *
 * `negative` and `unavailable` are subsets of the columns above them, not
 * extra rows. A replayed 404 is a genuine hit — it answered without going
 * upstream, which is all the rate claims — and an `unavailable` is a genuine
 * miss. They are broken out because each is the case that makes a
 * healthy-looking number and an unhealthy situation read identically: a host
 * hammering a dead link pushes the hit rate *up*.
 *
 * Read by constructed key rather than by SCAN, which is the one place this
 * file departs from its own discovery rule — deliberately.
 *
 * `MATCH` is applied server-side but the scan still walks the whole instance,
 * and lib/preview-cache.ts holds one key per track for a year: 200k+ keys, so
 * a single namespace scan is ~200 REST round-trips. Two more of those on every
 * `npm run stats` would triple the command cost of the one report this project
 * asks people to run at the start of every session — on a KV plan where the
 * roster poll's backoff ladder already exists to protect the same budget.
 *
 * Discovery earns its cost above because loop surface names are open-ended
 * (lib/loop-links.ts adds them). These kinds are not: both are closed unions
 * in TypeScript — `"hit" | "miss" | "negative"` in lib/playlist-cache.ts and
 * `"hit" | "miss" | "unavailable"` in lib/preview-cache.ts — so mirroring them
 * is mirroring a compile-checked set, and widening one without adding it here
 * is the one drift this trades for two commands instead of four hundred.
 */
async function cacheTotals(namespace, kinds, buckets) {
  const wanted = buckets.flatMap((day) =>
    kinds.map((kind) => `${namespace}:stats:${day}:${kind}`)
  );
  const counts = await mgetAll(wanted);

  const byKind = new Map();
  wanted.forEach((key, i) => {
    const kind = key.split(":")[3];
    const count = Number(counts[i] ?? 0);
    if (!Number.isFinite(count)) return;
    byKind.set(kind, (byKind.get(kind) ?? 0) + count);
  });
  return byKind;
}

const caches = [
  { name: "playlist", upstream: "Spotify", subset: "negative", kinds: ["hit", "miss", "negative"] },
  { name: "preview", upstream: "iTunes/Deezer", subset: "unavailable", kinds: ["hit", "miss", "unavailable"] },
];

const windowDays = bucketsFor(days);
const cacheRows = [];
for (const cache of caches) {
  const byKind = await cacheTotals(cache.name, cache.kinds, windowDays);
  const hits = byKind.get("hit") ?? 0;
  const misses = byKind.get("miss") ?? 0;
  if (hits + misses === 0) continue;
  cacheRows.push({ ...cache, hits, misses, subset: byKind.get(cache.subset) ?? 0 });
}

if (cacheRows.length > 0) {
  // Header and rows share the widths so they cannot drift apart.
  const row = (a, b, c, d, e) =>
    `${a.padEnd(13)}${b.padEnd(15)}${c.padStart(8)}${d.padStart(10)}${e.padStart(9)}`;
  console.log("\nUpstream cache — every miss is a call somebody else meters");
  console.log(row("Cache", "upstream", "hits", "misses", "rate"));
  console.log("─".repeat(55));
  for (const c of cacheRows) {
    console.log(
      row(c.name, c.upstream, String(c.hits), String(c.misses), pct(c.hits, c.hits + c.misses).trim())
    );
  }
  for (const c of cacheRows) {
    if (c.subset === 0) continue;
    if (c.name === "playlist") {
      // Subtracted rather than merely reported: a host retrying a playlist
      // they made private is the one input that inflates this rate, and it
      // inflates it in exactly the situation you would want it to fall.
      console.log(
        `\n  playlist: ${c.subset} of those hits replayed a cached 404 — ` +
          `real rate ${pct(c.hits - c.subset, c.hits + c.misses).trim()}`
      );
    } else {
      // The distinction lib/preview-cache.ts is built around: `absent` is a
      // fact about the recording and lasts a week, `unavailable` is a fact
      // about us being throttled or out of budget and lasts 90 seconds.
      console.log(
        `  preview:  ${c.subset} of those misses were us, not the catalogue ` +
          "(throttled or out of budget)"
      );
    }
  }
}

/**
 * Why a link was refused, for the refusals that are permanent.
 *
 * The replayed-404 line above says how often a dead link is retried; this
 * says what was dead, from `playlist_refused:<code>` in lib/loop-stats.ts —
 * and it is the only place an editorial playlist is counted at all, since
 * those are refused before the cache is read. Labels are the reader's, not
 * the code's: a code this script does not know prints as itself.
 */
const REFUSAL_LABELS = {
  playlist_not_found: "private or deleted",
  playlist_editorial: "Spotify's own (editorial)",
  playlist_empty: "empty",
  invalid_playlist_url: "not a playlist URL",
};
const refusals = [...totals.keys()]
  .filter((m) => m.startsWith("playlist_refused:"))
  .map((m) => m.slice("playlist_refused:".length))
  .sort((a, b) => get(`playlist_refused:${b}`) - get(`playlist_refused:${a}`));
if (refusals.length > 0) {
  const total = refusals.reduce((t, c) => t + get(`playlist_refused:${c}`), 0);
  const parts = refusals
    .map((c) => `${REFUSAL_LABELS[c] ?? c} ${get(`playlist_refused:${c}`)}`)
    .join(" · ");
  console.log(`\nPlaylist links refused — ${total} that will never work: ${parts}`);
  // What "not a playlist URL" was, from `playlist_invalid:<kind>` — written
  // in the same call as the total it splits, so the parts sum to it. Read by
  // name over the closed set lib/loop-stats.ts declares (PLAYLIST_INVALID_KINDS)
  // and in its order: a kind that was never pasted prints as 0, which is an
  // answer here, where a missing word would be a question.
  const invalidKinds = [
    ["album", "album"],
    ["track", "track"],
    ["artist", "artist"],
    ["shortlink", "dead short link"],
    ["other", "anything else"],
  ];
  const invalidTotal = invalidKinds.reduce((t, [k]) => t + get(`playlist_invalid:${k}`), 0);
  if (invalidTotal > 0) {
    const split = invalidKinds.map(([k, label]) => `${label} ${get(`playlist_invalid:${k}`)}`).join(" · ");
    console.log(`  not a playlist URL, by what it was: ${split}`);
    console.log(
      "  album is the one the app could choose to serve; the forms that block a\n" +
        "  wrong link never send it, so this is the party form and the quiz only"
    );
    const unsplit = get("playlist_refused:invalid_playlist_url") - invalidTotal;
    if (unsplit > 0) {
      console.log(`  (${unsplit} more were refused before the split was counted)`);
    }
  }
  const editorial = get("playlist_refused:playlist_editorial");
  if (editorial > 0 && editorial >= total / 4) {
    console.log(
      "  a quarter or more are Spotify's own playlists: hosts want the charts,\n" +
        "  and the app cannot serve them (37i9… returns 404 to new apps)"
    );
  }
}

/**
 * Whether a host shown a permanent refusal went on to play, per setup page
 * load (lib/refusal-recovery.ts): `refusal_recovery:<refused|recovered>:<topic>`
 * and, for a recovery, how — `refusal_recovery_via:<source>`. The topics
 * mirror PLAYLIST_HELP_TOPIC_NAMES in lib/playlist-help.ts.
 */
const RECOVERY_TOPICS = [
  ["private", "private or deleted"],
  ["wrong_link", "not a playlist link"],
  ["editorial", "Spotify's own"],
  ["empty", "empty"],
];
const recRefused = RECOVERY_TOPICS.reduce((t, [k]) => t + get(`refusal_recovery:refused:${k}`), 0);
const recRecovered = RECOVERY_TOPICS.reduce((t, [k]) => t + get(`refusal_recovery:recovered:${k}`), 0);
if (recRefused + recRecovered > 0) {
  console.log(
    `\nAfter a refusal on setup — ${recRecovered} of ${recRefused} pages went on to start a game (${pct(recRecovered, recRefused).trim()})`
  );
  for (const [k, label] of RECOVERY_TOPICS) {
    const r = get(`refusal_recovery:refused:${k}`);
    const ok = get(`refusal_recovery:recovered:${k}`);
    if (r + ok > 0) console.log(`  ${label.padEnd(22)} ${String(ok).padStart(5)} of ${String(r).padStart(5)}  ${pct(ok, r)}`);
  }
  const via = SETUP_SOURCE_ORDER.map((s) => [s, get(`refusal_recovery_via:${s}`)]).filter(([, n]) => n > 0);
  if (via.length) console.log(`  got past it by: ${via.map(([s, n]) => `${s} ${n}`).join(" · ")}`);
  console.log(
    "  how to read it: per page load, not per host — a host who reloads and tries\n" +
      "  again is two pages. `starter` here is the chips under the error doing their job;\n" +
      "  a low private-or-deleted rate is the help line not getting people unstuck."
  );
}

/**
 * Short links, and whether following them works from where this runs.
 *
 * `playlist_shortlink:<outcome>`, written by `resolveShortlink` in
 * lib/spotify-shortlink.ts for every short link the server was handed — a
 * form or Android's share sheet, a cached answer included. It is printed on
 * its own, outside the refusals above, because its best day has no refusal
 * in it: every link resolved to a playlist and loaded.
 */
const shortlinkOutcomes = [
  ["resolved", "followed"],
  ["unusable", "led nowhere usable"],
  ["unavailable", "could not be reached"],
];
const shortlinkTotal = shortlinkOutcomes.reduce((t, [o]) => t + get(`playlist_shortlink:${o}`), 0);
if (shortlinkTotal > 0) {
  const parts = shortlinkOutcomes
    .map(([o, label]) => `${label} ${get(`playlist_shortlink:${o}`)}`)
    .join(" · ");
  console.log(`\nShort links (spotify.link) — ${shortlinkTotal} pasted or shared: ${parts}`);
  const unreachable = get("playlist_shortlink:unavailable");
  if (unreachable > 0 && unreachable >= shortlinkTotal / 4) {
    console.log(
      "  a quarter or more could not be reached: the redirector is refusing or\n" +
        "  stalling this deployment's address, and those hosts were told to paste\n" +
        "  the full link — lib/spotify-shortlink.ts, not the links"
    );
  }
}

/**
 * Spotify's admission gate, over the window Spotify actually meters.
 *
 * The per-minute ceiling has never fired in production and never will at this
 * traffic shape; the rolling 24h one is the gate that decides whether an
 * evening has any playlist loads left in it. Its limit is a guess — Spotify
 * publishes no number — so the hour-by-hour shape below is the only evidence
 * there is for tuning it. Read it for *when* the window fills, not just
 * whether: a day spent by lunchtime and a day spent at 11pm need opposite
 * changes.
 *
 * The keys are written by `claimDailyBudget` in lib/playlist-cache.ts.
 */
const budgetHours = Array.from({ length: 24 }, (_, i) =>
  new Date(Date.now() - i * 60 * 60 * 1000).toISOString().slice(0, 13)
).reverse();
const [budgetUsed, budgetRefused] = [
  await mgetAll(budgetHours.map((h) => `spotify:budget:h:${h}`)),
  await mgetAll(budgetHours.map((h) => `spotify:budget:refused:${h}`)),
];
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const usedTotal = budgetUsed.reduce((t, v) => t + num(v), 0);
const refusedTotal = budgetRefused.reduce((t, v) => t + num(v), 0);

if (usedTotal + refusedTotal > 0) {
  const peak = Math.max(...budgetUsed.map(num), 1);
  console.log("\nSpotify upstream budget — rolling 24h, the window that cuts us off");
  console.log(
    `  ${usedTotal} loads sent upstream, ${refusedTotal} refused here before Spotify saw them`
  );
  console.log("");
  for (const [i, hour] of budgetHours.entries()) {
    const used = num(budgetUsed[i]);
    const refused = num(budgetRefused[i]);
    // Hours with nothing in them are the finding, not noise — a flat evening
    // after a full afternoon is exactly the shape a daily cap can produce.
    const bar = "█".repeat(Math.round((used / peak) * 32));
    const tail = refused > 0 ? `  (${refused} refused)` : "";
    console.log(
      `  ${hour.slice(11)}:00  ${String(used).padStart(4)}  ${bar}${tail}`
    );
  }
}

console.log(
  "\nRead these as floors, not measurements:\n" +
    "  · Repeat hosts are undercounted — iOS clears localStorage after 7 days\n" +
    "    idle, which is exactly the gap between two parties.\n" +
    "  · Followed counts miss anyone whose click never reached the server.\n" +
    "  · A low number can mean the CTA does not work, or that we could not see\n" +
    "    that it did. Only the direction over time is trustworthy.\n" +
    "  · The cache table is the exception. Those counters are incremented on\n" +
    "    the server, on the path itself, so nothing can drop one — read them\n" +
    "    as the measurement the loop numbers are not.\n"
);
