/**
 * Cache and admission control in front of Spotify playlist loads.
 *
 * Spotify's client-credentials quota is per *app*, not per user or per IP.
 * Every rate limiter in this codebase is keyed by IP (lib/rate-limit.ts), so
 * N players from N phones each got a fresh allowance against one shared
 * upstream budget — and nothing anywhere cached a playlist. The same URL
 * re-paginated in full on every submit, every retry, and every player in a
 * room who happened to paste the same link. That is what produced
 * `429 QUOTA_EXCEEDED`.
 *
 * Three layers, cheapest first:
 *
 *   loadPlaylist ─→ KV cache ─────── hit ──→ return (zero upstream calls)
 *                       │ miss
 *                       ├─ in-flight map ── hit ──→ await the existing fetch
 *                       │ miss
 *                       ├─ cooldown gate ── open ─→ throw 429 immediately
 *                       │ closed
 *                       └─ Spotify ─→ store ─→ return
 *
 * The cooldown is the layer that actually lets the quota recover. Without it
 * a throttled window is self-sustaining: every host sees an error, every host
 * retries, and the retries keep the quota pinned. One 429 from Spotify parks
 * *all* uncached loads for the duration it asked for.
 *
 * In front of all three sits the one step that is not about Spotify's quota
 * at all: finding out what was pasted (`playableFor`). A link that is a
 * track, an artist page or nothing is refused there, and a short link is
 * followed there, before the cache is read and before any budget is claimed
 * — none of it touches the Web API, so none of it may spend or wait on the
 * API's allowance. An album is not refused: since 2026-10-25 it loads through
 * every layer here exactly as a playlist does, under its own cache key.
 *
 * Every KV call is wrapped. A cache outage must degrade to "slower", never to
 * "broken" — same contract as app/api/preview/route.ts, which this follows.
 */

import { dayBucket, getKvStore, hourBucket } from "@/lib/kv";
import {
  getAlbumWithTracks,
  getPlaylistWithTracks,
  isSpotifyEditorial,
  SpotifyApiError,
} from "@/lib/spotify";
import {
  classifySpotifyLink,
  isNamedLinkKind,
  isPlayableLink,
  NAMED_LINK_CODES,
  playableUrl,
  type PlayableKind,
  type PlayableLink,
} from "@/lib/spotify-link";
import { resolveShortlink } from "@/lib/spotify-shortlink";
import { stripTrackForStorage } from "@/lib/game-session";
import type { AppErrorCode } from "@/lib/error-messages";
import {
  isPlaylistRefusalCode,
  recordPlaylistAlbum,
  recordPlaylistInvalid,
  recordPlaylistRecheck,
  recordPlaylistRefused,
  type PlaylistInvalidKind,
  type PlaylistRecheckOutcome,
} from "@/lib/loop-stats";
import type { SpotifyServiceStatus } from "@/types/service-status";
import type { Track } from "@/types";

/**
 * Bump when the cached shape changes *incompatibly*. Entries are TTL'd rather
 * than migrated, so an old-shape read would otherwise be handed to callers as
 * a valid hit.
 *
 * Adding an optional field is not that, and must not bump it. 1.20.1 added
 * `releaseDate` to every track and left this at v1: a bump turns every warm
 * key into a miss at once, and the week it was measured the cache answered
 * ~20k hits against ~7.5k misses (73%), i.e. ~2,900 extra cold loads a day on
 * a daily ceiling of `DEFAULT_DAILY_LOAD_LIMIT` that the misses alone already
 * fill halfway. Every entry lives at most `HIT_TTL_SECONDS`, so the cache
 * upgrades itself through ordinary turnover within a day, and a consumer that
 * needs the new field treats a track without it as unusable rather than as a
 * reason to refetch (`lib/order-game.ts`). That is also why the mode that
 * reads the field shipped one release after the field itself.
 */
const CACHE_VERSION = "v1";

/**
 * Long enough that a party spends zero upstream requests after the first load
 * — including the host reloading, re-pasting, or every player in a room
 * submitting the same popular playlist.
 *
 * Six hours was too short, and the counters said so before the quota did.
 * Parties are a nightly event: a playlist first loaded at 8pm is cold again by
 * 8pm the next day, so the cache only ever held about a fifth of a day's
 * playlists — 406 warm keys against 2,152 cold loads in a day, a 26% hit rate,
 * and every one of those misses spending the app's shared Spotify quota. A day
 * covers tonight-to-tomorrow-night, which is the interval that actually
 * repeats here. The cost is that a host who adds songs this afternoon may not
 * see them tonight; that is a worse trade at six hours than it looks, because
 * the alternative it bought was the whole site being locked out of Spotify.
 */
const HIT_TTL_SECONDS = 24 * 60 * 60;

/**
 * Shorter, for playlists too big to read whole. Those are cached as a *random
 * sample* of MAX_PLAYLIST_TRACKS, so the TTL is also how long everyone is
 * stuck with the same draw. Six hours would mean a 4,000-track playlist plays
 * the same 500 songs all evening, which is the thing sampling exists to avoid;
 * an hour still absorbs a party's worth of retries and reloads.
 */
const SAMPLED_TTL_SECONDS = 60 * 60;

/**
 * Negative caching, deliberately much shorter than the preview cache's.
 * A 404 here usually means "public playlist, wrong link" or "the owner made it
 * private", both of which a host fixes within minutes; caching that for days
 * would keep telling them their fixed playlist is broken. Ten minutes is
 * enough to absorb the burst of retries a bad paste generates.
 */
const NOT_FOUND_TTL_SECONDS = 10 * 60;

/**
 * How long a loaded playlist is kept *after* it stops being fresh, to be
 * served only when the alternative is refusing the host.
 *
 * `HIT_TTL_SECONDS` decides freshness and is unchanged; this is the copy we
 * hold back. From 2026-10-07 the site ran ~5,000 games a day against a 2,000
 * load ceiling, and on 2026-10-08 the misses came to exactly 2,000 — the gate
 * was shut that evening, and every host it turned away was a cold load,
 * which for a returning host (half of all games start on a remembered link)
 * is very often a playlist we had loaded a day or two earlier and then
 * deleted. A week-old copy of a party playlist is a better answer than "the
 * site is out of Spotify for today".
 *
 * So a stale entry is served when Spotify cannot be asked — a cooldown, the
 * daily ceiling spent or within `SPOTIFY_BUDGET_WARN_RATIO` of it, the minute
 * gate, an upstream error — and refreshed otherwise. A refresh that comes back
 * 404 is believed and not papered over: the owner made it private or deleted
 * it, and that is theirs to decide. Storage is the cost, measured at ~48KB an
 * entry and ~1,100 live entries at one day, against a 3GB instance.
 */
const STALE_GRACE_SECONDS = 6 * 24 * 60 * 60;

/**
 * The youngest a cached 404 may be before an explicit recheck is allowed to go
 * past it. See `LoadOptions.recheck`.
 */
export const RECHECK_MIN_AGE_MS = 15 * 1000;

const COOLDOWN_KEY = "spotify:cooldown";

/**
 * Proactive ceiling on how many playlist loads the *whole site* sends upstream
 * per minute, shared across lambda instances via KV's atomic incr.
 *
 * The cooldown below is reactive — it only helps once Spotify has already
 * refused something. This is the half that stops us reaching that point: a
 * traffic spike, a scripted client, or a dozen rooms starting at once gets
 * refused here rather than spending the app's quota to find out.
 *
 * The number is in *loads*, not requests. One cold load costs 1 metadata call
 * plus up to MAX_TRACK_PAGES track pages, so the default 40 works out to a
 * ceiling of roughly 240 upstream requests a minute. Cache hits never reach
 * here, so this bounds genuinely-new playlists only. Env-overridable because
 * the right value depends on which quota tier the Spotify app is on, and that
 * is not something the code can find out.
 */
const GLOBAL_LOAD_WINDOW_SECONDS = 60;
const DEFAULT_GLOBAL_LOAD_LIMIT = 40;
const BUDGET_KEY = "spotify:budget";

/**
 * The same idea over the window that actually cuts us off.
 *
 * The per-minute gate above bounds a *burst*. It has never once fired in
 * production — `spotify:budget` was observed at 0-1 all through the outage of
 * 2026-08-23 — because it is guarding the wrong dimension. Spotify's refusal
 * is a quota over roughly 24 hours, and a day's worth of traffic arriving at
 * an average of one or two loads a minute passes a 40-a-minute ceiling
 * without ever touching it. Both gates are needed: this one cannot stop a QR
 * room's twelve simultaneous submits, and that one cannot stop an ordinary
 * Sunday.
 *
 * **The window is rolling, not a calendar day, and that is not a detail.**
 * Measured 2026-08-23: the app was refused after only 476 cold loads that day,
 * because the previous evening's 2,152 were still inside Spotify's window, and
 * the `Retry-After` pointed at 19:53 UTC rather than any midnight. A
 * `dayBucket` counter reset at 00:00 UTC would have let a busy evening and the
 * following busy morning each pass their own cap while together exceeding
 * anything Spotify would allow — the exact failure it was added to prevent. So
 * the counter is twenty-four hourly buckets, summed.
 *
 * The hourly buckets are also the only record of *when* the day is spent,
 * which is the number the limit below has to be tuned against; `npm run stats`
 * prints them.
 */
const DAILY_WINDOW_HOURS = 24;
const HOUR_BUCKET_TTL_SECONDS = (DAILY_WINDOW_HOURS + 1) * 60 * 60;
const HOUR_BUDGET_PREFIX = "spotify:budget:h";
const HOUR_REFUSED_PREFIX = "spotify:budget:refused";

/**
 * Written when the window is spent, read by `getSpotifyServiceStatus`.
 *
 * The status route is a page-view-rate path and its whole cost claim is "one
 * KV read". Summing twenty-four hourly buckets there to answer a yes/no would
 * quietly make the notice more expensive than the gate it reports on, so the
 * gate leaves a flag behind instead and the notice reads it in the same `mget`
 * it already spends on the cooldown. TTL'd to the hour boundary, which is when
 * the oldest bucket rolls out and the answer can change.
 */
const DAILY_SPENT_KEY = "spotify:budget:spent";

/**
 * The same trick one step earlier: written when the day's spend crosses
 * BUDGET_WARN_RATIO, read by `getSpotifyServiceStatus` in the same `mget`.
 *
 * The notice this drives fires while the site still works, which is the whole
 * point — a host who learns at the refusal has already lost the choice the
 * warning gives them. It cannot be answered by counting buckets in the status
 * route for the reason DAILY_SPENT_KEY gives, and it must not cost a second
 * command either, so the gate leaves this behind on the pass it was already
 * making.
 *
 * Same hour-boundary TTL as the spent flag, and for the same reason: an hour
 * rolling out of the window is the only thing that can lower the answer.
 */
const DAILY_NEAR_KEY = "spotify:budget:near";

/**
 * How much of the day's allowance has to be gone before hosts are warned.
 *
 * 0.8 of 2,000 is 1,600 loads. Against a normal day's ~2,152 cold loads that
 * trips most evenings, which is deliberate: the warning is only worth anything
 * on the days the limit is actually in play, and those are most of them. Set it
 * higher to warn later and less often.
 */
const DEFAULT_BUDGET_WARN_RATIO = 0.8;

function budgetWarnRatio(): number {
  const configured = Number(process.env.SPOTIFY_BUDGET_WARN_RATIO);
  return Number.isFinite(configured) && configured > 0 && configured < 1
    ? configured
    : DEFAULT_BUDGET_WARN_RATIO;
}

/**
 * Loads allowed upstream per rolling 24h, before we start refusing on
 * Spotify's behalf.
 *
 * Every input to this number is an inference, so it is env-overridable and
 * deliberately easy to find. What is known: Spotify does not publish a figure;
 * the developer dashboard showed ~3,850 requests on the day the quota died;
 * and since 1.7.1 a cold load costs ~1.2 requests rather than ~2.2. 2,000
 * loads is therefore ~2,400 requests — under the wall by a margin, and just
 * under a normal day's 2,152 cold loads, so it will occasionally refuse at the
 * margin.
 *
 * That last part is the trade, stated plainly: refusing perhaps a hundred
 * loads at the edge of a busy day is chosen over Spotify refusing *every*
 * uncached load for 13.4 unconditional hours, which is what it did. Ours is a
 * counter that rolls forward hour by hour; theirs is a penalty box with a
 * fixed sentence.
 */
const DEFAULT_DAILY_LOAD_LIMIT = 2000;

/**
 * Spotify's Retry-After on QUOTA_EXCEEDED is sometimes enormous and sometimes
 * absent. Measured on 2026-08-23: `retry-after: 52531`, `reason:
 * QUOTA_EXCEEDED` — 14.6 hours, because the exhausted thing is a daily app
 * quota rather than a burst window.
 *
 * The old cap was 15 minutes, on the reasoning that the site should never be
 * parked longer than a party would wait. That conflated two separate numbers.
 * How long we back off is one; what we tell the host is the other, and the cap
 * was silently deciding both. Against a 14.6-hour refusal it produced a host
 * being told "try again in about 780s", waiting thirteen minutes, coming back,
 * and being told 780s again — a countdown the app had no way to honour.
 *
 * So the honest figure is what gets stored and reported, and the 15 minutes
 * survives as COOLDOWN_PROBE_SECONDS: the TTL on the key, not the value in it.
 */
const MIN_COOLDOWN_SECONDS = 30;
const MAX_COOLDOWN_SECONDS = 24 * 60 * 60;
const DEFAULT_COOLDOWN_SECONDS = 60;

/**
 * How long the gate stays shut before one wave of requests is allowed upstream
 * to find out whether Spotify has relented.
 *
 * The stored `until` can be hours away, and trusting it blindly would mean one
 * bad Retry-After header locks every uncached playlist out for a day with no
 * way back except deleting the key by hand. Expiring the *key* early instead
 * costs one refused request per interval and is self-correcting: the probe's
 * own 429 carries a fresh Retry-After, which rewrites the cooldown. Cheap
 * against a daily quota, and the alternative is a foot-gun with a 24h fuse.
 */
const COOLDOWN_PROBE_SECONDS = 15 * 60;

/**
 * Above this, a countdown stops being information and becomes a promise.
 *
 * Ten minutes is roughly the point where "try again in Ns" reads as "wait,
 * then it will work" rather than "this is a blip". Past it the host gets the
 * quota message instead: same facts, no number to sit and watch.
 */
const COUNTDOWN_MAX_SECONDS = 10 * 60;

export interface LoadedPlaylist {
  /**
   * What the link was. Derived from the link, never stored: the cache entry
   * is the same shape under either key. An album is counted on the way out
   * (`playlist_album:loaded`), and the game page hides its album award.
   */
  kind: PlayableKind;
  name: string;
  tracks: Track[];
  totalTracks: number;
  /** True when the playlist is longer than MAX_PLAYLIST_TRACKS. */
  truncated: boolean;
}

/**
 * Which caller a load came from, named in the miss log.
 *
 * The log viewer attributes a line to whichever request the instance happened
 * to be serving, and under concurrent invocations that can be an unrelated
 * request — a miss from `POST /api/room/[code]/submit` showing up against a
 * `GET .../pool` that never touches this file. Reading the method off the log
 * row then points at a code path that cannot produce the line, which is a long
 * detour to nowhere. Carry the caller in the message so it stands on its own.
 *
 * `unknown` is the default rather than a required argument: a new caller that
 * forgets should still load, and the literal string `source=unknown` in the
 * logs is a clearer report of that omission than a compile error nobody sees
 * in production.
 */
export type PlaylistLoadSource = "playlist-api" | "room-submit" | "quiz-create" | "unknown";

type CacheEntry =
  /**
   * `freshUntil` (epoch ms) is when the entry stops being served as a plain
   * hit; the key itself lives `STALE_GRACE_SECONDS` longer. Optional because
   * entries written before it existed are still live, and those are fresh for
   * as long as their own TTL keeps them — which is the rule they were written
   * under.
   */
  | { kind: "hit"; name: string; tracks: Track[]; truncated: boolean; freshUntil?: number }
  /**
   * `code` is what a replayed 404 is rendered from, so a cached miss is
   * readable in either language — caching a *sentence* would have frozen
   * whichever language wrote the entry into every later reader's screen for
   * the whole TTL. Optional because entries written before this field existed
   * are still live in KV; `readCache` falls back for them.
   */
  | {
      kind: "missing";
      code?: AppErrorCode;
      message: string;
      status: number;
      /** Epoch ms of the 404. Absent on older entries, which a recheck may pass. */
      at?: number;
    };

export interface LoadOptions {
  /**
   * The host says they have just made the playlist public: go past a cached
   * 404 rather than replaying it.
   *
   * The help line under a private-playlist refusal tells the host to make it
   * public and try again, and for ten minutes afterwards (`NOT_FOUND_TTL_SECONDS`)
   * this cache answered "private" to the host who had done exactly that — one
   * reason that refusal recovered 18% of the time. The button sends this, and
   * so does the setup page's one-off check half a minute after a refusal
   * (`automatic`); a mashed Start does not, so the negative cache still absorbs
   * the bursts it exists for, and a 404 younger than `RECHECK_MIN_AGE_MS` is
   * still replayed so the button cannot be turned into a burst either.
   */
  recheck?: boolean;
  /**
   * The recheck was sent by the setup page on its own, once, half a minute
   * after the refusal — not by the host pressing the button.
   *
   * Spotify's API keeps answering 404 for a playlist for a while after it is
   * made public, and flaps between 404 and 200 in that window: on 2026-10-16
   * 18 of 38 "private" refusals were already public, tracks and all, within
   * seconds of the 404 we cached, and two of those hosts never asked again.
   * The automatic one asks for them. It is the one extra Spotify call a
   * refusal can cost without anyone pressing anything, so it yields first:
   * under any of the site notice's three pressure keys it replays the cached
   * 404 instead of asking (`replayed`), and only `recheck` lets it past.
   */
  automatic?: boolean;
}

/**
 * Errors this module answered from a cached 404 on a recheck rather than by
 * asking Spotify, so the recheck counter can tell "Spotify still says no"
 * from "we did not ask". Before they were split, a press seconds after the
 * refusal read as the playlist still being private.
 */
const replayedRechecks = new WeakSet<object>();

/** A recheck this module answered from a cached 404 without asking Spotify. */
export function isReplayedRecheck(err: unknown): boolean {
  return typeof err === "object" && err !== null && replayedRechecks.has(err);
}

/**
 * A playlist's key is byte-for-byte what it was before albums could load —
 * `playlist:v1:<id>` — because a change to it is the cold start
 * `CACHE_VERSION`'s comment costs out. An album gets its own prefix rather
 * than sharing the playlist's: the two id spaces are Spotify's, not ours,
 * and one key holding two answers is the bug every `fold()` in this codebase
 * exists to prevent.
 */
function cacheKey(link: PlayableLink): string {
  return `${link.kind}:${CACHE_VERSION}:${link.id}`;
}

async function readCache(link: PlayableLink): Promise<CacheEntry | null> {
  try {
    const store = await getKvStore();
    return await store.get<CacheEntry>(cacheKey(link));
  } catch {
    return null;
  }
}

async function writeCache(
  link: PlayableLink,
  entry: CacheEntry,
  ttlSeconds: number
): Promise<void> {
  try {
    const store = await getKvStore();
    await store.set(cacheKey(link), entry, ttlSeconds);
  } catch {
    // Swallowed: the caller already has its answer, and failing the request
    // over a cache write would turn a degraded cache into a broken game.
  }
}

async function readCooldownUntil(): Promise<number | null> {
  try {
    const store = await getKvStore();
    const entry = await store.get<{ until: number }>(COOLDOWN_KEY);
    return typeof entry?.until === "number" ? entry.until : null;
  } catch {
    return null;
  }
}

/**
 * Records that Spotify is throttling the app. Stored in KV rather than module
 * scope on purpose — unlike the token cache, this is only useful if every
 * lambda instance sees it. A per-instance cooldown would park one instance
 * while the rest carried on spending the quota it is trying to protect.
 */
async function startCooldown(retryAfterSeconds?: number): Promise<number> {
  const seconds = Math.min(
    MAX_COOLDOWN_SECONDS,
    Math.max(MIN_COOLDOWN_SECONDS, retryAfterSeconds ?? DEFAULT_COOLDOWN_SECONDS)
  );
  const until = Date.now() + seconds * 1000;
  try {
    const store = await getKvStore();
    // The value is honest, the TTL is short. See COOLDOWN_PROBE_SECONDS: every
    // reader inside the window is told the real wait, and when the key expires
    // one request goes and checks rather than the site staying parked on a
    // number Spotify sent hours ago.
    await store.set(
      COOLDOWN_KEY,
      { until },
      Math.min(seconds, COOLDOWN_PROBE_SECONDS)
    );
  } catch {
    // Best effort. Losing the cooldown costs us the coordinated backoff, not
    // correctness — each request still fails on its own 429.
  }
  return seconds;
}

function globalLoadLimit(): number {
  const configured = Number(process.env.SPOTIFY_MAX_LOADS_PER_MINUTE);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_GLOBAL_LOAD_LIMIT;
}

/**
 * Claims one slot in the current minute's global budget. Returns false when
 * the window is spent.
 *
 * Fails *open* on a KV error: the budget is a safety net, and losing the net
 * has to mean "back to how it was", not "nobody can load a playlist". The
 * cooldown still catches the resulting 429 if we overshoot.
 */
async function claimGlobalBudget(): Promise<boolean> {
  try {
    const store = await getKvStore();
    const used = await store.incr(BUDGET_KEY, GLOBAL_LOAD_WINDOW_SECONDS);
    return used <= globalLoadLimit();
  } catch {
    return true;
  }
}

function dailyLoadLimit(): number {
  const configured = Number(process.env.SPOTIFY_MAX_LOADS_PER_DAY);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_DAILY_LOAD_LIMIT;
}

/** The window, newest hour first, as keys under `prefix`. */
function windowKeys(prefix: string, now: Date): string[] {
  return Array.from({ length: DAILY_WINDOW_HOURS }, (_, i) =>
    `${prefix}:${hourBucket(new Date(now.getTime() - i * 60 * 60 * 1000))}`
  );
}

function sum(counts: Array<number | null>): number {
  return counts.reduce<number>(
    (total, n) => total + (typeof n === "number" && Number.isFinite(n) ? n : 0),
    0
  );
}

/**
 * How long until the oldest hour in the window rolls out and its share of the
 * budget comes back. Reported as a header, never rendered as a countdown —
 * `spotify_daily_budget_spent` carries no `{seconds}`, for the reason
 * lib/error-messages.ts gives.
 */
function secondsToNextHour(now: Date): number {
  return Math.ceil((3600000 - (now.getTime() % 3600000)) / 1000);
}

/**
 * Claims one load against the rolling 24h budget. Returns false when the
 * window is spent.
 *
 * Read-then-increment rather than the increment-then-compare `claimGlobalBudget`
 * uses, and the asymmetry is deliberate in both directions. A minute counter
 * that counts its own refusals is self-healing — the window is gone in sixty
 * seconds. A 24h one is not: refusals would inflate the very sum that caused
 * them and hold the gate shut for a day, so only loads that are actually going
 * upstream may touch it. The cost is that the check is not atomic against
 * itself, so a burst can overshoot by however many requests are in flight at
 * once — which the per-minute gate has already capped at `globalLoadLimit()`,
 * a rounding error against a limit in the thousands.
 *
 * Fails *open*, like every other gate in this file: losing the safety net has
 * to mean "back to how it was", not "nobody can play".
 */
async function claimDailyBudget(now: Date): Promise<boolean> {
  try {
    const store = await getKvStore();
    const used = sum(await store.mget<number>(windowKeys(HOUR_BUDGET_PREFIX, now)));
    if (used >= dailyLoadLimit()) {
      // Counted, not logged per request: a spent window refuses every uncached
      // load for as long as it lasts, and a log line each would be the noisiest
      // output in the app on the day it is least useful to read.
      const frees = secondsToNextHour(now);
      await store.incr(
        `${HOUR_REFUSED_PREFIX}:${hourBucket(now)}`,
        HOUR_BUCKET_TTL_SECONDS
      );
      await store.set(DAILY_SPENT_KEY, { until: now.getTime() + frees * 1000 }, frees);
      return false;
    }
    await store.incr(
      `${HOUR_BUDGET_PREFIX}:${hourBucket(now)}`,
      HOUR_BUCKET_TTL_SECONDS
    );

    // `used` is already in hand from the admission check above, so the warning
    // costs one conditional set on the crossing loads and nothing at all on the
    // rest of the day. Counting it separately in the status route is what this
    // exists to avoid.
    if (used + 1 >= dailyLoadLimit() * budgetWarnRatio()) {
      const frees = secondsToNextHour(now);
      await store.set(DAILY_NEAR_KEY, { until: now.getTime() + frees * 1000 }, frees);
    }
    return true;
  } catch {
    return true;
  }
}

/**
 * The rolling window as `npm run stats` reads it: the totals, and the shape
 * of the day that produced them.
 *
 * `byHour` is oldest first. It answers the question the limit has to be tuned
 * against and that nothing else in this repo can — not "how many loads did we
 * spend" (`playlist:stats:*:miss` has that) but *when*, and therefore whether
 * a cap is starving the evening to feed the afternoon.
 */
export async function getDailyBudgetStatus(now: Date = new Date()): Promise<{
  used: number;
  refused: number;
  limit: number;
  byHour: Array<{ hour: string; used: number; refused: number }>;
}> {
  const store = await getKvStore();
  const usedKeys = windowKeys(HOUR_BUDGET_PREFIX, now);
  const refusedKeys = windowKeys(HOUR_REFUSED_PREFIX, now);
  const [used, refused] = await Promise.all([
    store.mget<number>(usedKeys),
    store.mget<number>(refusedKeys),
  ]);
  const byHour = usedKeys
    .map((key, i) => ({
      hour: key.slice(HOUR_BUDGET_PREFIX.length + 1),
      used: sum([used[i]]),
      refused: sum([refused[i]]),
    }))
    .reverse();
  return { used: sum(used), refused: sum(refused), limit: dailyLoadLimit(), byHour };
}

/**
 * Hit/miss counters, bucketed by day and held for a week.
 *
 * Without these, "did the cache work" can only be answered by watching for the
 * absence of 429s, which is indistinguishable from a quiet evening. The rate
 * is logged on every miss rather than on every load: misses are the rare case
 * once the cache is doing its job, so the instrumentation gets quieter exactly
 * as things get healthier, and a sudden run of lines is itself the signal.
 */
function statsKey(kind: "hit" | "miss" | "negative" | "stale" | "refreshed"): string {
  return `playlist:stats:${dayBucket()}:${kind}`;
}

const STATS_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * `negative` counts the subset of hits that replayed a cached 404 or a cached
 * empty playlist. Those are
 * real hits — the question was answered without touching Spotify, which is all
 * `rate` claims to measure — but they are the one kind a *broken* input
 * produces on repeat. A host retrying a playlist they made private pushes the
 * rate up, so counting them silently makes the healthiest-looking number and
 * one of the unhealthiest situations read identically. Kept inside `hits` so
 * the rate keeps its meaning, and reported alongside so it can be subtracted.
 */
async function recordHit(negative = false): Promise<void> {
  try {
    const store = await getKvStore();
    await store.incr(statsKey("hit"), STATS_TTL_SECONDS);
    if (negative) await store.incr(statsKey("negative"), STATS_TTL_SECONDS);
  } catch {
    // Instrumentation must never be able to fail a request.
  }
}

/**
 * The two halves of the stale copy, counted apart.
 *
 * `stale` is a load answered from a copy past `freshUntil` because Spotify
 * could not be asked — a hit as far as the rate is concerned (it is counted in
 * `hit` too), and the number that says how many hosts the grace period kept
 * playing. `refreshed` is a stale copy that was there and went upstream
 * anyway: every one of those is a miss a longer `HIT_TTL_SECONDS` would have
 * saved, which is the figure that decision has to be made on.
 */
async function recordStale(kind: "stale" | "refreshed"): Promise<void> {
  try {
    const store = await getKvStore();
    if (kind === "stale") await store.incr(statsKey("hit"), STATS_TTL_SECONDS);
    await store.incr(statsKey(kind), STATS_TTL_SECONDS);
  } catch {
    // Instrumentation must never be able to fail a request.
  }
}

/**
 * `misses=` is the running day total and is free — it is what `incr` returns.
 * The line used to carry `hits=`, `negative=` and a cumulative `rate=` as well,
 * which cost two extra KV reads on every miss to compose a sentence for a log
 * nobody tails. `getCacheStats` answers the cumulative question on demand, for
 * the caller that actually asks it (`npm run stats`), which is where this
 * project has decided numbers are read.
 */
async function recordMiss(
  link: PlayableLink,
  source: PlaylistLoadSource
): Promise<void> {
  try {
    const store = await getKvStore();
    const misses = await store.incr(statsKey("miss"), STATS_TTL_SECONDS);
    // A playlist's id prints bare, as it always has; an album's is prefixed
    // so the two cannot be read as one series.
    const id = link.kind === "album" ? `album:${link.id}` : link.id;
    console.log(
      `[playlist-cache] miss id=${id} source=${source} misses=${misses}`
    );
  } catch {
    // Instrumentation must never be able to fail a request.
  }
}

/**
 * Today's counters, for anything that wants to read the rate back. The day
 * bucket is UTC, so a rate read shortly after 00:00 UTC is measuring a handful
 * of loads — every playlist's first load of the day is a miss by definition.
 */
export async function getCacheStats(): Promise<{
  hits: number;
  misses: number;
  /** Hits that replayed a cached 404 or empty playlist, already in `hits`. */
  negativeHits: number;
  /** Hits answered from a copy past its freshness, already in `hits`. */
  staleHits: number;
  /** Misses that had a stale copy to hand, already in `misses`. */
  refreshed: number;
  hitRate: number;
}> {
  const store = await getKvStore();
  const [hits, misses, negativeHits, staleHits, refreshed] = (
    await store.mget<number>(
      (["hit", "miss", "negative", "stale", "refreshed"] as const).map(statsKey)
    )
  ).map((n) => n ?? 0);
  const total = hits + misses;
  return {
    hits,
    misses,
    negativeHits,
    staleHits,
    refreshed,
    hitRate: total > 0 ? hits / total : 0,
  };
}

/**
 * The same fact, phrased for the wait the host is actually facing.
 *
 * A short cooldown is a blip and a countdown is the useful thing to say. A
 * long one is the app's daily Spotify quota being gone, where a countdown is
 * worse than no number at all — it invites the host to wait it out and press
 * Start again into the same refusal. `retryAfterSeconds` stays honest in both
 * cases; it is a header, not a sentence.
 */
function cooldownError(secondsRemaining: number): SpotifyApiError {
  if (secondsRemaining > COUNTDOWN_MAX_SECONDS) {
    return new SpotifyApiError("spotify_quota_exhausted", 429, {
      retryAfterSeconds: secondsRemaining,
    });
  }

  return new SpotifyApiError("spotify_cooldown", 429, {
    retryAfterSeconds: secondsRemaining,
    params: { seconds: secondsRemaining },
  });
}

/**
 * The cooldown as a fact a *page* can render, rather than an error a request
 * had to hit to find out.
 *
 * Read-only, and deliberately outside the admission path: it claims no budget,
 * records no miss and never goes upstream, so asking "is Spotify refusing us
 * right now?" costs one KV read. That is what lets the site notice be live
 * instead of a banner somebody has to remember to take down — the same key
 * that parks the loads clears the notice when it expires.
 *
 * The code comes from `cooldownError`, not from a second threshold written
 * here. A notice that said "throttled, back in ten minutes" while the host's
 * own Start button said "the daily quota is gone" would be worse than no
 * notice: two numbers for one fact, and the reader has to guess which is
 * lying. One function decides, both surfaces read it.
 */
export type { SpotifyServiceStatus };

const OPEN_STATUS: SpotifyServiceStatus = {
  throttled: false,
  approachingLimit: false,
  code: null,
  retryAfterSeconds: 0,
};

export async function getSpotifyServiceStatus(): Promise<SpotifyServiceStatus> {
  // Both gates in one command, because there are two ways for the playlist
  // path to be shut and a notice that knew about only one would be confidently
  // wrong on the days the other fires — which, at a limit tuned just under a
  // normal day, is not the rare case.
  //
  // Fail-open is the only defensible answer here, for the same reason
  // lib/rate-limit.ts fails open: a KV outage must not put a "we are broken"
  // banner on a site that is, as far as anyone can tell, fine.
  let cooldown: { until: number } | null = null;
  let spent: { until: number } | null = null;
  let near: { until: number } | null = null;
  try {
    const store = await getKvStore();
    [cooldown, spent, near] = await store.mget<{ until: number }>([
      COOLDOWN_KEY,
      DAILY_SPENT_KEY,
      DAILY_NEAR_KEY,
    ]);
  } catch {
    return OPEN_STATUS;
  }

  const remainingOf = (entry: { until: number } | null): number =>
    typeof entry?.until === "number" ? Math.ceil((entry.until - Date.now()) / 1000) : 0;

  // Spotify's own refusal outranks ours. When both are live the host is facing
  // the longer wait, and it is the one they can do nothing about.
  const cooling = remainingOf(cooldown);
  if (cooling > 0) {
    return {
      throttled: true,
      approachingLimit: false,
      code: cooldownError(cooling).code,
      retryAfterSeconds: cooling,
    };
  }

  const rationed = remainingOf(spent);
  if (rationed > 0) {
    return {
      throttled: true,
      approachingLimit: false,
      code: "spotify_daily_budget_spent",
      retryAfterSeconds: rationed,
    };
  }

  // Only reached when nothing is actually refusing. A refusal outranks the
  // warning it grew out of: "you are about to run out" is the wrong sentence to
  // show someone who already has, and `approachingLimit` stays false above so
  // no caller has to decide which of two live states to render.
  if (remainingOf(near) > 0) {
    return {
      throttled: false,
      approachingLimit: true,
      code: "spotify_budget_low",
      // Nothing to wait for — the site works. See the message's own note on why
      // it carries no countdown.
      retryAfterSeconds: 0,
    };
  }

  return OPEN_STATUS;
}

/**
 * Whether a stale copy should be served without asking Spotify at all.
 *
 * The same three keys the site notice reads, so "we served you yesterday's
 * copy" and "the notice says we are near the limit" are one fact. Waiting
 * until the gate actually refuses would spend the last of the day on
 * refreshing playlists we already have, and leave nothing for the host whose
 * playlist we have never seen. Fails to false: the load then goes through the
 * ordinary gates, each of which fails open, and falls back to the copy if one
 * of them refuses.
 */
async function spotifyUnderPressure(): Promise<boolean> {
  try {
    const store = await getKvStore();
    const entries = await store.mget<{ until: number }>([
      COOLDOWN_KEY,
      DAILY_SPENT_KEY,
      DAILY_NEAR_KEY,
    ]);
    const now = Date.now();
    return entries.some((entry) => typeof entry?.until === "number" && entry.until > now);
  } catch {
    return false;
  }
}

function isFresh(entry: Extract<CacheEntry, { kind: "hit" }>): boolean {
  return typeof entry.freshUntil !== "number" || Date.now() < entry.freshUntil;
}

/**
 * Coalesces concurrent loads of the same playlist within one lambda instance.
 *
 * Mixed Playlist Mode fires one request per contributor from a single click,
 * and a QR room gets a burst of submits as everyone scans at once. Duplicated
 * URLs in either of those used to mean duplicated pagination, because the KV
 * write only lands after the first fetch finishes — too late for its own
 * siblings. Per-instance rather than distributed: a cross-instance lock would
 * need a primitive lib/kv.ts doesn't have, for a shrinking share of the win
 * now that results are cached.
 */
const inFlight = new Map<string, Promise<LoadedPlaylist>>();

function toLoaded(
  entry: Extract<CacheEntry, { kind: "hit" }>,
  link: PlayableLink
): LoadedPlaylist {
  return {
    kind: link.kind,
    name: entry.name,
    tracks: entry.tracks,
    totalTracks: entry.tracks.length,
    truncated: entry.truncated,
  };
}

/**
 * The one upstream read, by kind. Both answer in the same shape so that
 * everything after this line — the strip, the TTLs, the cache write — is one
 * path, and an album cannot be cached by a rule a playlist is not.
 */
async function fetchUpstream(
  link: PlayableLink
): Promise<{ name: string; tracks: Track[]; truncated: boolean }> {
  if (link.kind === "album") {
    const { album, tracks, truncated } = await getAlbumWithTracks(link.id);
    return { name: album.name, tracks, truncated };
  }
  // By the address built from the id, not by what was pasted. The paste may
  // be a short link, which lib/spotify.ts cannot read and must not follow —
  // and the id is the thing this function was already keyed on.
  const { playlist, tracks, truncated } = await getPlaylistWithTracks(playableUrl(link));
  return { name: playlist.name, tracks, truncated };
}

/** What a cached 404 replays as when the entry predates `code`. */
function notFoundCode(link: PlayableLink): AppErrorCode {
  return link.kind === "album" ? "album_not_found" : "playlist_not_found";
}

async function fetchAndCache(
  link: PlayableLink,
  source: PlaylistLoadSource
): Promise<LoadedPlaylist> {
  const cooldownUntil = await readCooldownUntil();
  if (cooldownUntil && Date.now() < cooldownUntil) {
    throw cooldownError(Math.ceil((cooldownUntil - Date.now()) / 1000));
  }

  if (!(await claimGlobalBudget())) {
    throw new SpotifyApiError("spotify_busy", 429, {
      retryAfterSeconds: GLOBAL_LOAD_WINDOW_SECONDS,
    });
  }

  // After the per-minute gate, never before it. A load refused for bursting
  // has not gone upstream, so it must not spend a slot in the 24h window that
  // takes a day to give one back; a load refused here has spent a minute slot
  // instead, which is back in sixty seconds.
  const now = new Date();
  if (!(await claimDailyBudget(now))) {
    throw new SpotifyApiError("spotify_daily_budget_spent", 429, {
      retryAfterSeconds: secondsToNextHour(now),
    });
  }

  await recordMiss(link, source);

  try {
    const { name, tracks, truncated } = await fetchUpstream(link);

    // rawJson is the entire Spotify track object and nothing reads it — every
    // consumer runs it through stripTrackForStorage before use. Dropping it
    // here keeps cache entries (and the /api/playlist response body) roughly
    // an order of magnitude smaller.
    const stripped = tracks.map(stripTrackForStorage);

    // An empty playlist is cached too, for the 404's ten minutes rather than a
    // day: it is the same "fix it and come back" refusal (`playlist_empty`,
    // raised by the callers from the empty list), and uncached every retry of
    // it spent a full load and a daily-budget slot to be told it again.
    const freshSeconds =
      stripped.length === 0
        ? NOT_FOUND_TTL_SECONDS
        : truncated
          ? SAMPLED_TTL_SECONDS
          : HIT_TTL_SECONDS;
    await writeCache(
      link,
      {
        kind: "hit",
        name,
        tracks: stripped,
        truncated,
        freshUntil: Date.now() + freshSeconds * 1000,
      },
      // An empty playlist gets no grace: it is a refusal, and a week-old
      // refusal is not a better answer than asking again.
      stripped.length === 0 ? freshSeconds : freshSeconds + STALE_GRACE_SECONDS
    );

    return {
      kind: link.kind,
      name,
      tracks: stripped,
      totalTracks: stripped.length,
      truncated,
    };
  } catch (err) {
    if (err instanceof SpotifyApiError && err.status === 429) {
      const seconds = await startCooldown(err.retryAfterSeconds);
      throw cooldownError(seconds);
    }

    // Only 404 is cached. A 429 is transient by definition and a 5xx is
    // Spotify's problem, not this playlist's — caching either would make a
    // blip look like a broken playlist for as long as the entry lived.
    if (err instanceof SpotifyApiError && err.status === 404) {
      await writeCache(
        link,
        { kind: "missing", code: err.code, message: err.message, status: 404, at: Date.now() },
        NOT_FOUND_TTL_SECONDS
      );
    }

    throw err;
  }
}

/**
 * Load a playlist's tracks, going upstream only when it isn't already known.
 *
 * Drop-in replacement for calling getPlaylistWithTracks directly — every
 * caller should use this instead, since a single uncached path is enough to
 * put the shared quota back at risk.
 *
 * This wrapper also counts the refusals that will never change —
 * `PLAYLIST_REFUSAL_CODES` in `lib/loop-stats.ts` — on the way out. It sits
 * here and not in the routes because this is the one function all three
 * callers share, and because an editorial playlist is refused before the
 * cache is read and so appeared in no cache statistic at all: the hit rate
 * could say one load in eight was a dead link and nothing could say why.
 * A throttling code is not counted here; the budget block already does.
 *
 * A link that was never a playlist is counted twice over, on purpose: once
 * as `playlist_refused:invalid_playlist_url`, whatever sentence the host was
 * shown, so that series stays comparable with every week before the
 * sentences were split — and once as `playlist_invalid:<kind>`, which is what
 * the refusal actually was. `recordPlaylistInvalid` writes the pair together.
 * A short link that could not be followed is in neither; it is not a refusal.
 */
export async function loadPlaylist(
  playlistUrl: string,
  source: PlaylistLoadSource = "unknown",
  options: LoadOptions = {}
): Promise<LoadedPlaylist> {
  let loaded: LoadedPlaylist;
  try {
    loaded = await loadPlaylistUncounted(playlistUrl, source, options);
  } catch (err) {
    if (options.recheck) await recordPlaylistRecheck(recheckOutcomeOf(err), options.automatic === true);
    // The page's own recheck is not a person told their link is dead — its
    // outcome is `playlist_autocheck:*`. Counting it here as well would
    // double "private or deleted" against every week before it existed.
    if (options.automatic === true) throw err;
    const invalid = invalidKindOf(err);
    if (invalid) {
      await recordPlaylistInvalid(invalid);
    } else if (err instanceof SpotifyApiError && isPlaylistRefusalCode(err.code)) {
      await recordPlaylistRefused(err.code);
    }
    throw err;
  }
  // Not thrown here — `app/api/playlist/route.ts` and `lib/room.ts` each
  // raise `playlist_empty` in their own vocabulary — but it is the same
  // refusal, and counting it where the other three are counted keeps the
  // four reasons on one line in `npm run stats`.
  // An empty playlist is a refusal the route raises, not a playlist found: a
  // recheck that loads one counts `other`, and the page's own is never a
  // `playlist_refused` (see the catch above).
  const empty = loaded.tracks.length === 0;
  if (empty && options.automatic !== true) await recordPlaylistRefused("playlist_empty");
  // An album that played, hit or miss — the number that replaced
  // `playlist_invalid:album`, which counted the same links being turned away.
  // Not for the page's own recheck, for the reason the refusals above are not.
  if (!empty && loaded.kind === "album" && options.automatic !== true) {
    await recordPlaylistAlbum("loaded");
  }
  if (options.recheck) await recordPlaylistRecheck(empty ? "other" : "found", options.automatic === true);
  return loaded;
}

/**
 * What a recheck came back as. `missing` is Spotify still saying 404;
 * `replayed` is our cached 404 handed back without asking (seconds old, or an
 * automatic recheck while Spotify is under pressure); `other` is anything that
 * says nothing about the playlist (throttled, a bad link).
 */
function recheckOutcomeOf(err: unknown): PlaylistRecheckOutcome {
  if (isReplayedRecheck(err)) return "replayed";
  return err instanceof SpotifyApiError &&
    (err.code === "playlist_not_found" || err.code === "album_not_found")
    ? "missing"
    : "other";
}

/**
 * A link refused for what it *is*, before Spotify has been asked anything.
 *
 * A `SpotifyApiError` so that all three callers carry it to the client the
 * way they carry every other refusal, with `invalid` riding along for the
 * counter. The code is the sentence the host reads and the kind is the
 * bucket it is filed under, and they are separate because they do not map
 * one to one: a dead short link and a line of chat both read "that doesn't
 * look like a playlist link", and are different findings.
 */
class PlaylistLinkError extends SpotifyApiError {
  constructor(
    code: AppErrorCode,
    readonly invalid: PlaylistInvalidKind
  ) {
    super(code, 400);
  }
}

/**
 * Which `playlist_invalid` bucket a refusal belongs in, or null when it is
 * not that kind of refusal. A bare `invalid_playlist_url` — one this file did
 * not raise — is `other` rather than uncounted, so the buckets keep summing
 * to the total whoever threw it.
 */
function invalidKindOf(err: unknown): PlaylistInvalidKind | null {
  if (err instanceof PlaylistLinkError) return err.invalid;
  if (err instanceof SpotifyApiError && err.code === "invalid_playlist_url") return "other";
  return null;
}

/**
 * What was pasted, as a playlist or an album — following a short link to
 * find out when that is what it takes.
 *
 * Everything here happens before the cache is read and before any budget is
 * claimed, and none of it touches the Web API, so a refusal from this
 * function is as true during a cooldown as outside one. That is the rule the
 * editorial check below follows, one step earlier: telling someone who
 * pasted a track "we're rate limited, try again in 60s" sends them back
 * with the same track.
 */
async function playableFor(pasted: string): Promise<PlayableLink> {
  let link = classifySpotifyLink(pasted);

  if (link.kind === "shortlink") {
    const resolution = await resolveShortlink(link.url);
    if (resolution.status === "unavailable") {
      // Retryable, and it must stay so — see the code's entry in
      // lib/error-messages.ts. Not a PlaylistLinkError: nothing is known
      // about this link, so there is no refusal to count.
      throw new SpotifyApiError("playlist_shortlink_unavailable", 503);
    }
    if (resolution.status === "unusable") {
      throw new PlaylistLinkError("invalid_playlist_url", "shortlink");
    }
    link = resolution.link;
  }

  // A playlist or an album reached through a short link is that thing. The
  // question the counter answers is what people are trying to play.
  if (isPlayableLink(link)) return link;
  if (isNamedLinkKind(link.kind)) {
    throw new PlaylistLinkError(NAMED_LINK_CODES[link.kind], link.kind);
  }
  throw new PlaylistLinkError("invalid_playlist_url", "other");
}

async function loadPlaylistUncounted(
  playlistUrl: string,
  source: PlaylistLoadSource,
  options: LoadOptions
): Promise<LoadedPlaylist> {
  const link = await playableFor(playlistUrl);

  // Checked here as well as inside getPlaylistWithTracks so it stays true
  // during a cooldown: an editorial playlist is permanently unsupported, and
  // telling that host "we're rate limited, try again in 60s" would send them
  // back to a URL that is never going to work. Playlists only: `37i9` is a
  // playlist-id convention, and an album whose id happened to begin with it
  // would be refused for a reason that does not exist.
  if (link.kind === "playlist" && isSpotifyEditorial(link.id)) {
    throw new SpotifyApiError("playlist_editorial", 404);
  }

  const cached = await readCache(link);
  if (cached?.kind === "hit" && isFresh(cached)) {
    // A replayed empty playlist is a negative hit, like a replayed 404: the
    // one kind of hit a broken input produces on repeat. `loadPlaylist` counts
    // it as `playlist_refused:playlist_empty` from the empty list either way.
    await recordHit(cached.tracks.length === 0);
    return toLoaded(cached, link);
  }
  // Past its freshness: kept for exactly this, see STALE_GRACE_SECONDS.
  const stale = cached?.kind === "hit" ? cached : null;
  if (stale && (await spotifyUnderPressure())) {
    await recordStale("stale");
    return toLoaded(stale, link);
  }
  const recheckable =
    cached?.kind === "missing" &&
    options.recheck === true &&
    Date.now() - (cached.at ?? 0) >= RECHECK_MIN_AGE_MS &&
    !(options.automatic === true && (await spotifyUnderPressure()));
  if (cached?.kind === "missing" && !recheckable) {
    // A cached 404 is a cache hit too — it is a question answered without
    // touching Spotify, which is the only thing the rate measures. Counted
    // separately as well, so a spammed dead link can't quietly inflate it.
    await recordHit(true);
    // Entries written before `code` existed carry only a message, and the only
    // thing cached here is a 404, so that is what they replay as.
    const replay = new SpotifyApiError(cached.code ?? notFoundCode(link), cached.status, {
      detail: cached.code ? undefined : cached.message,
    });
    if (options.recheck) replayedRechecks.add(replay);
    throw replay;
  }

  // The page's own recheck yields to pressure with nothing cached as well: its
  // 404 can expire during the half-minute wait or a hidden tab's hold, and a
  // cold load then is the one call `automatic` exists not to spend. Handed
  // back as a replayed refusal, so the page says nothing about the playlist.
  if (!cached && options.automatic === true && (await spotifyUnderPressure())) {
    const replay = new SpotifyApiError(notFoundCode(link), 404);
    replayedRechecks.add(replay);
    throw replay;
  }

  if (!stale) return fetchCoalesced(link, source);

  try {
    const fresh = await fetchCoalesced(link, source);
    await recordStale("refreshed");
    return fresh;
  } catch (err) {
    // A 404 is the owner's answer and is passed on; anything else — every
    // throttling code, the minute gate, a 5xx, a dropped connection — is
    // ours or Spotify's, and the copy we hold is the better thing to hand
    // a host than that.
    if (err instanceof SpotifyApiError && err.status === 404) throw err;
    await recordStale("stale");
    return toLoaded(stale, link);
  }
}

function fetchCoalesced(
  link: PlayableLink,
  source: PlaylistLoadSource
): Promise<LoadedPlaylist> {
  // Keyed like the cache, so an album and a playlist that share an id (they
  // are Spotify's two id spaces, not one) cannot join each other's fetch.
  const key = cacheKey(link);
  const existing = inFlight.get(key);
  if (existing) return existing;

  // The source recorded is the one that *started* the fetch — a coalesced
  // sibling joins a load already in progress and never reaches recordMiss,
  // which is correct: the line describes the upstream call, not the request.
  const pending = fetchAndCache(link, source).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, pending);
  return pending;
}

/** Test seam: the in-flight map is module state that outlives a single test. */
export function __resetInFlightForTests(): void {
  inFlight.clear();
}
