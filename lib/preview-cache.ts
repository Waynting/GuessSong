/**
 * Cache and admission control in front of the 30s preview lookups.
 *
 * Spotify stopped populating `preview_url` for most tracks in Nov 2024, so the
 * clip a round plays is resolved from iTunes, then Deezer. Both throttle per
 * IP, and a serverless deploy's egress IPs are shared across the whole user
 * base — from iTunes' side the entire site is one very noisy client.
 *
 * This is the same shape of problem lib/playlist-cache.ts solves for Spotify,
 * with the numbers an order of magnitude worse. Spotify is called once per
 * *playlist*; these are called once per *track*, and a cold 50-song game is 50
 * lookups of up to 5 upstream calls each. Per-IP limiting (lib/rate-limit.ts)
 * does nothing about it: every new visitor gets a fresh allowance while the
 * egress IP they all share does not.
 *
 *   getPreview ─→ KV cache ─┬─ hit ────────→ return (zero upstream calls)
 *                           │ miss
 *                           ├─ budget ── spent ──→ unavailable, no upstream
 *                           │ claimed
 *                           └─ per-source cooldown ─→ iTunes ×2 ─→ Deezer ×3
 *
 * ## Three outcomes, not two
 *
 * The bug this module was extracted to fix: the old route mapped every failure
 * onto `previewUrl: null` and cached it for a week. A 403 from a throttled
 * iTunes, a dropped connection, a 500 — all of them were written down as the
 * fact "this song has no preview anywhere". One throttled minute at peak
 * therefore marked a slice of the catalogue silent for seven days, and it never
 * reproduced locally, because a laptop's own IP is never the one being
 * throttled.
 *
 *   found        a URL. Cached ~forever; recordings do not change.
 *   absent       upstream answered, and it genuinely has no preview. Cached a
 *                week, so a track that gains one later isn't written off.
 *   unavailable  we could not ask. Cached ninety seconds — long enough to stop
 *                a round's worth of retries stampeding, short enough that it is
 *                never mistaken for an answer.
 *
 * Only a clean, complete reply from upstream may produce `absent`. Everything
 * else is `unavailable`. That asymmetry is the whole point: a wrong `absent`
 * lasts a week and is invisible, a wrong `unavailable` costs one retry.
 *
 * ## Why the cache key is not versioned
 *
 * The stored record is a strict superset of the `{previewUrl}` shape that
 * shipped before it, and the key is deliberately unchanged. Bumping a version
 * the way lib/playlist-cache.ts does would cold-start every entry in production
 * simultaneously — precisely the upstream burst this file exists to prevent.
 * Legacy entries read fine; they just carry no source or track ids until the
 * next time they're written.
 */

import { getKvStore, type KvStore } from "@/lib/kv";
import type { PreviewResult, PreviewStatus } from "@/types/preview";

export type { PreviewResult, PreviewStatus };

export type PreviewSource = "itunes" | "deezer";

export interface PreviewQuery {
  /** Spotify (or built-in) track id. Keys the cache when present. */
  id: string;
  track: string;
  artist: string;
}

/**
 * What lands in KV. Every field beyond `previewUrl` is optional because
 * entries written by the pre-Phase-1 route are still live and must keep
 * reading as valid hits — see the header.
 */
interface PreviewRecord {
  previewUrl: string | null;
  source?: PreviewSource;
  /**
   * Lets a rotted URL be re-resolved with a single `lookup?id=` call instead of
   * the full five-call search fan-out. This is what makes a year-long positive
   * TTL safe: preview URLs sit on a CDN that rotates them, so the entry has to
   * be repairable on demand rather than merely expiring eventually.
   */
  itunesTrackId?: number;
  deezerTrackId?: number;
  /**
   * `false` marks a null that means "we could not ask". Absent on legacy
   * entries, which are therefore read as confirmed — deliberately. Re-resolving
   * every legacy negative at once to purge the poisoned ones would be the same
   * thundering herd that poisoned them; they age out within a week on their
   * own, and nothing new joins them.
   */
  confirmed?: boolean;
  /**
   * With a year-long TTL, an entry with no timestamp is undebuggable: a URL
   * resolved yesterday and one resolved last spring look identical, and "how
   * old are the URLs that stopped playing" is the first question worth asking
   * when they start rotting.
   */
  resolvedAt?: number;
}

/** Recordings don't change. URL rot is handled by refresh, not by expiry. */
const FOUND_TTL_SECONDS = 365 * 24 * 60 * 60;
/** Shorter, so a track that gains a preview later isn't written off forever. */
const ABSENT_TTL_SECONDS = 7 * 24 * 60 * 60;
/**
 * Long enough to absorb one round's retries, and past the global budget window
 * below so a retry lands in a fresh minute rather than re-losing the same one.
 * Short enough that nobody plays a whole game against a stale refusal.
 */
const UNAVAILABLE_TTL_SECONDS = 90;

/**
 * Proactive ceiling on how many *lookups* the whole site sends upstream per
 * minute, shared across lambda instances via KV's atomic incr. The direct
 * counterpart of SPOTIFY_MAX_LOADS_PER_MINUTE, and it exists for the same
 * reason: the cooldown below is reactive and only helps once iTunes has already
 * refused something.
 *
 * In lookups, not requests — a found track costs one upstream call, one with no
 * preview anywhere costs five. Apple documents roughly 20 calls a minute and in
 * practice allows a good deal more, so the default sits between the two: a
 * couple of simultaneous cold games get through, a scripted client or a spike
 * does not. Env-overridable because the real ceiling is a property of the
 * deploy's egress IPs, which the code cannot find out.
 */
const LOOKUP_WINDOW_SECONDS = 60;
const DEFAULT_MAX_LOOKUPS_PER_MINUTE = 120;
const BUDGET_KEY = "preview:budget";

/** Same clamps, and the same reasoning, as lib/playlist-cache.ts's cooldown. */
const MIN_COOLDOWN_SECONDS = 30;
const MAX_COOLDOWN_SECONDS = 15 * 60;
const DEFAULT_COOLDOWN_SECONDS = 60;

const STATS_TTL_SECONDS = 7 * 24 * 60 * 60;

/* ------------------------------------------------------------------ */
/* Keys                                                                */
/* ------------------------------------------------------------------ */

/**
 * Track id is the stable identity — the same recording appears under varying
 * name/artist strings across playlists (feat. credits, remaster tags, casing),
 * which would fragment a string-keyed cache. Falls back to a normalised query
 * key so callers without an id still get caching.
 */
export function previewCacheKey(id: string, track: string, artist: string): string {
  if (id) return `preview:id:${id}`;
  // Normalise each part before joining, not the joined string: Spotify track
  // names carry stray leading/trailing whitespace, and trimming only the ends
  // of "track|artist" would leave " song |artist" as a distinct key from
  // "song|artist" — quietly fragmenting the cache for the same recording.
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return `preview:q:${normalize(track)}|${normalize(artist)}`;
}

function cooldownKey(source: PreviewSource): string {
  return `preview:cooldown:${source}`;
}

function statsKey(kind: "hit" | "miss" | "unavailable"): string {
  const day = new Date().toISOString().slice(0, 10);
  return `preview:stats:${day}:${kind}`;
}

/* ------------------------------------------------------------------ */
/* KV access — every call wrapped, a cache outage means slower not broken */
/* ------------------------------------------------------------------ */

async function store(): Promise<KvStore> {
  return getKvStore();
}

async function readRecords(keys: string[]): Promise<Array<PreviewRecord | null>> {
  try {
    return await (await store()).mget<PreviewRecord>(keys);
  } catch {
    return keys.map(() => null);
  }
}

function ttlFor(status: PreviewStatus): number {
  if (status === "found") return FOUND_TTL_SECONDS;
  return status === "absent" ? ABSENT_TTL_SECONDS : UNAVAILABLE_TTL_SECONDS;
}

async function writeRecord(key: string, record: PreviewRecord, status: PreviewStatus): Promise<void> {
  try {
    await (await store()).set(key, record, ttlFor(status));
  } catch {
    // Swallowed deliberately. An unhandled write failure would turn a request
    // that already has its answer into a 500 and stall the game mid-round.
  }
}

function recordToResult(record: PreviewRecord): PreviewResult {
  if (record.previewUrl) return { previewUrl: record.previewUrl, status: "found" };
  // `confirmed === false` is the only thing that means "we couldn't ask".
  // Legacy entries have no field at all and are read as confirmed.
  return { previewUrl: null, status: record.confirmed === false ? "unavailable" : "absent" };
}

/* ------------------------------------------------------------------ */
/* Admission control                                                   */
/* ------------------------------------------------------------------ */

function lookupLimit(): number {
  const configured = Number(process.env.PREVIEW_MAX_LOOKUPS_PER_MINUTE);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_LOOKUPS_PER_MINUTE;
}

/**
 * Claims `count` slots in the current minute's global budget. All-or-nothing,
 * so a batch either gets its whole fan-out or defers cleanly rather than
 * stopping halfway through a game.
 *
 * Fails *open* on a KV error, exactly like lib/playlist-cache.ts: losing the
 * safety net has to mean "back to how it was", not "nobody hears any music".
 */
async function claimLookupBudget(count = 1): Promise<boolean> {
  if (count <= 0) return true;
  try {
    const used = await (await store()).incr(BUDGET_KEY, LOOKUP_WINDOW_SECONDS, count);
    return used <= lookupLimit();
  } catch {
    return true;
  }
}

async function isCoolingDown(source: PreviewSource): Promise<boolean> {
  try {
    const entry = await (await store()).get<{ until: number }>(cooldownKey(source));
    return typeof entry?.until === "number" && Date.now() < entry.until;
  } catch {
    return false;
  }
}

/**
 * Parks one source after it has explicitly refused us.
 *
 * In KV rather than module scope, for lib/playlist-cache.ts's reason: a
 * per-instance cooldown would sit out one lambda while the rest carried on
 * spending the allowance it is trying to protect.
 */
async function startCooldown(source: PreviewSource, retryAfterSeconds?: number): Promise<void> {
  const seconds = Math.min(
    MAX_COOLDOWN_SECONDS,
    Math.max(MIN_COOLDOWN_SECONDS, retryAfterSeconds ?? DEFAULT_COOLDOWN_SECONDS)
  );
  try {
    await (await store()).set(cooldownKey(source), { until: Date.now() + seconds * 1000 }, seconds);
    console.warn(`[preview-cache] ${source} throttled us; pausing it for ${seconds}s`);
  } catch {
    // Best effort — losing the coordinated backoff costs us the shared signal,
    // not correctness. Each request still fails on its own.
  }
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

interface Outcomes {
  hits: number;
  misses: number;
  /** Misses that could not be answered. Not a subset of `misses`. */
  unavailable: number;
}

/**
 * Bucketed by UTC day and held a week, mirroring lib/playlist-cache.ts.
 *
 * Logged on misses only: once the cache is doing its job misses are the rare
 * case, so the instrumentation goes quiet exactly as things get healthier and a
 * sudden run of lines is itself the signal. `unavailable=` is the one to watch
 * — it rising while `misses` stays flat is throttling, and it is the number
 * that used to be silently recorded as a catalogue gap instead.
 */
async function recordOutcomes(counts: Outcomes): Promise<void> {
  try {
    const kv = await store();
    if (counts.hits > 0) await kv.incr(statsKey("hit"), STATS_TTL_SECONDS, counts.hits);
    if (counts.unavailable > 0) {
      await kv.incr(statsKey("unavailable"), STATS_TTL_SECONDS, counts.unavailable);
    }
    if (counts.misses <= 0) return;

    const misses = await kv.incr(statsKey("miss"), STATS_TTL_SECONDS, counts.misses);
    const hits = (await kv.get<number>(statsKey("hit"))) ?? 0;
    const unavailable = (await kv.get<number>(statsKey("unavailable"))) ?? 0;
    const rate = hits + misses > 0 ? hits / (hits + misses) : 0;
    console.log(
      `[preview-cache] miss hits=${hits} misses=${misses} unavailable=${unavailable} rate=${rate.toFixed(3)}`
    );
  } catch {
    // Instrumentation must never be able to fail a request.
  }
}

/**
 * Today's counters. The day bucket is UTC, so a read shortly after 00:00 UTC is
 * measuring almost nothing — every track's first lookup of the day is a miss.
 */
export async function getPreviewCacheStats(): Promise<
  Outcomes & { hitRate: number }
> {
  const kv = await store();
  const hits = (await kv.get<number>(statsKey("hit"))) ?? 0;
  const misses = (await kv.get<number>(statsKey("miss"))) ?? 0;
  const unavailable = (await kv.get<number>(statsKey("unavailable"))) ?? 0;
  const total = hits + misses;
  return { hits, misses, unavailable, hitRate: total > 0 ? hits / total : 0 };
}

/* ------------------------------------------------------------------ */
/* Upstream                                                            */
/* ------------------------------------------------------------------ */

type SourceOutcome =
  | { kind: "found"; previewUrl: string; trackId?: number }
  /** Upstream answered, and it has nothing. The only path to a cached `absent`. */
  | { kind: "empty" }
  | {
      kind: "unavailable";
      /**
       * True only when upstream explicitly refused (403/429, or Deezer's quota
       * error body). A dropped connection is unavailable too, but must not park
       * the source for everyone — one flaky socket is not a rate limit.
       */
      throttled: boolean;
      retryAfterSeconds?: number;
    };

function retryAfterFrom(res: { headers: Headers }): number | undefined {
  const raw = res.headers?.get?.("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/**
 * Maps a response's status onto an outcome, before any body parsing.
 *
 * Note that iTunes signals throttling with **403**, not 429. Reading only 429
 * is the same mistake as reading only the happy path: the refusal arrives, gets
 * classified as "no result", and becomes a fact about the song.
 */
function statusOutcome(res: { ok: boolean; status: number; headers: Headers }): SourceOutcome | null {
  if (res.status === 403 || res.status === 429) {
    return { kind: "unavailable", throttled: true, retryAfterSeconds: retryAfterFrom(res) };
  }
  // Any other non-OK is "we could not ask" as well. Nothing upstream can say
  // with a 5xx, or a 400 we didn't expect, is evidence about the recording.
  if (!res.ok) return { kind: "unavailable", throttled: false };
  return null;
}

interface ItunesResult {
  previewUrl?: string;
  trackId?: number;
  trackName?: string;
  artistName?: string;
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<
  { ok: true; res: Response; body: unknown } | { ok: false; outcome: SourceOutcome }
> {
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch {
    return { ok: false, outcome: { kind: "unavailable", throttled: false } };
  }

  const bad = statusOutcome(res);
  if (bad) return { ok: false, outcome: bad };

  try {
    return { ok: true, res, body: await res.json() };
  } catch {
    // A 200 we can't parse is not an answer either.
    return { ok: false, outcome: { kind: "unavailable", throttled: false } };
  }
}

function pickItunes(results: ItunesResult[] | undefined, track: string): SourceOutcome {
  if (!Array.isArray(results)) return { kind: "unavailable", throttled: false };
  // Prefer an exact track-name match, fall back to the first with a preview.
  const exact = results.find(
    (r) => r.previewUrl && r.trackName?.toLowerCase() === track.toLowerCase()
  );
  const match = exact ?? results.find((r) => r.previewUrl);
  if (match?.previewUrl) {
    return { kind: "found", previewUrl: match.previewUrl, trackId: match.trackId };
  }
  // Results with no preview among them is a real answer: iTunes knows the
  // catalogue and has no clip for it.
  return { kind: "empty" };
}

async function queryItunes(term: string, track: string): Promise<SourceOutcome> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
    term
  )}&media=music&entity=musicTrack&limit=10`;
  const got = await fetchJson(url, { Accept: "application/json" });
  if (!got.ok) return got.outcome;
  return pickItunes((got.body as { results?: ItunesResult[] })?.results, track);
}

/** The cheap repair path: one call, no searching, when we already know the id. */
async function lookupItunes(trackId: number, track: string): Promise<SourceOutcome> {
  const got = await fetchJson(`https://itunes.apple.com/lookup?id=${trackId}`, {
    Accept: "application/json",
  });
  if (!got.ok) return got.outcome;
  return pickItunes((got.body as { results?: ItunesResult[] })?.results, track);
}

interface DeezerResult {
  preview?: string;
  id?: number;
}

async function queryDeezer(q: string): Promise<SourceOutcome> {
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=10`;
  const got = await fetchJson(url, {
    "User-Agent": "Mozilla/5.0",
    Accept: "application/json",
  });
  if (!got.ok) return got.outcome;

  // Deezer reports its quota limit in the *body* of a 200, so a status-only
  // check reads "quota exceeded" as "no such song".
  const body = got.body as { data?: DeezerResult[]; error?: { code?: number } };
  if (body?.error) {
    return { kind: "unavailable", throttled: true, retryAfterSeconds: retryAfterFrom(got.res) };
  }
  if (!Array.isArray(body?.data)) return { kind: "unavailable", throttled: false };

  const match = body.data.find((r) => r.preview);
  if (match?.preview) return { kind: "found", previewUrl: match.preview, trackId: match.id };
  return { kind: "empty" };
}

interface Resolution {
  status: PreviewStatus;
  previewUrl: string | null;
  source?: PreviewSource;
  itunesTrackId?: number;
  deezerTrackId?: number;
}

const UNRESOLVED: Resolution = { status: "unavailable", previewUrl: null };

/**
 * Asks iTunes then Deezer, skipping either while it is cooling down.
 *
 * Returns `absent` only if every source we asked gave a clean, complete reply
 * and none of them had a clip. If any source was skipped, refused us, or failed
 * mid-question, the answer is `unavailable` — we do not know, and saying
 * otherwise for a week is the defect this module exists to prevent.
 */
async function askUpstream(track: string, artist: string): Promise<Resolution> {
  let blocked = false;

  const ask = async (
    source: PreviewSource,
    queries: string[],
    run: (q: string) => Promise<SourceOutcome>
  ): Promise<Resolution | null> => {
    if (await isCoolingDown(source)) {
      blocked = true;
      return null;
    }
    for (const q of queries) {
      const outcome = await run(q);
      if (outcome.kind === "found") {
        return {
          status: "found",
          previewUrl: outcome.previewUrl,
          source,
          ...(source === "itunes"
            ? { itunesTrackId: outcome.trackId }
            : { deezerTrackId: outcome.trackId }),
        };
      }
      if (outcome.kind === "unavailable") {
        blocked = true;
        if (outcome.throttled) await startCooldown(source, outcome.retryAfterSeconds);
        // Stop asking this source. A second query against a host that just
        // refused us spends a call to be refused again.
        return null;
      }
    }
    return null;
  };

  const fromItunes = await ask("itunes", [`${track} ${artist}`.trim(), track], (q) =>
    queryItunes(q, track)
  );
  if (fromItunes) return fromItunes;

  const fromDeezer = await ask(
    "deezer",
    [`track:"${track}" artist:"${artist}"`, `${track} ${artist}`.trim(), track],
    queryDeezer
  );
  if (fromDeezer) return fromDeezer;

  return blocked ? UNRESOLVED : { status: "absent", previewUrl: null };
}

function toRecord(resolution: Resolution): PreviewRecord {
  return {
    previewUrl: resolution.previewUrl,
    ...(resolution.source ? { source: resolution.source } : {}),
    ...(resolution.itunesTrackId ? { itunesTrackId: resolution.itunesTrackId } : {}),
    ...(resolution.deezerTrackId ? { deezerTrackId: resolution.deezerTrackId } : {}),
    ...(resolution.status === "unavailable" ? { confirmed: false } : {}),
    resolvedAt: Date.now(),
  };
}

/**
 * Resolves one track upstream and stores the outcome. Assumes the caller has
 * already claimed budget for it.
 *
 * `existing` carries the ids from a previous resolution, so a refresh costs one
 * `lookup?id=` call rather than the full search fan-out.
 */
async function resolveAndStore(
  query: PreviewQuery,
  key: string,
  existing: PreviewRecord | null
): Promise<PreviewResult> {
  let resolution: Resolution | null = null;

  if (existing?.itunesTrackId && !(await isCoolingDown("itunes"))) {
    const outcome = await lookupItunes(existing.itunesTrackId, query.track);
    if (outcome.kind === "found") {
      resolution = {
        status: "found",
        previewUrl: outcome.previewUrl,
        source: "itunes",
        itunesTrackId: outcome.trackId ?? existing.itunesTrackId,
      };
    }
    // An empty or failed lookup falls through to a full search: the id may have
    // been retired from the store entirely, which a search can still route
    // around by finding the re-release.
  }

  resolution ??= await askUpstream(query.track, query.artist);

  await writeRecord(key, toRecord(resolution), resolution.status);
  return { previewUrl: resolution.previewUrl, status: resolution.status };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export interface GetPreviewOptions {
  /**
   * Ignore a cached hit and re-resolve. For a URL that stopped playing — the
   * CDN rotates them — which is the failure a long positive TTL trades for the
   * upstream calls it saves.
   */
  refresh?: boolean;
}

export async function getPreview(
  query: PreviewQuery,
  options: GetPreviewOptions = {}
): Promise<PreviewResult> {
  const key = previewCacheKey(query.id, query.track, query.artist);
  const [existing] = await readRecords([key]);

  if (existing && !options.refresh) {
    await recordOutcomes({ hits: 1, misses: 0, unavailable: 0 });
    return recordToResult(existing);
  }

  if (!(await claimLookupBudget())) {
    // Deliberately not cached. The claim is already one cheap atomic op and is
    // self-limiting, where writing a marker would spend a KV write per track
    // during exactly the spike we are trying to ride out.
    await recordOutcomes({ hits: 0, misses: 0, unavailable: 1 });
    return { previewUrl: null, status: "unavailable" };
  }

  const result = await resolveAndStore(query, key, existing);
  await recordOutcomes({
    hits: 0,
    misses: 1,
    unavailable: result.status === "unavailable" ? 1 : 0,
  });
  return result;
}

/**
 * How many tracks one batch may resolve upstream.
 *
 * A cap rather than "all of them" so a single 50-song cold start cannot eat the
 * whole minute's global budget and starve every other party on the site. The
 * remainder come back `unavailable`, which the game page resolves lazily as it
 * reaches them — the same path it used before batching existed.
 */
const DEFAULT_MAX_UPSTREAM_PER_BATCH = 25;

/**
 * How long a batch may keep starting new resolutions.
 *
 * Serverless functions have a hard wall-clock limit, and a batch that hits it
 * returns nothing at all — strictly worse than returning what it had. Tracks
 * not started by the deadline come back `unavailable` and are picked up lazily.
 */
const BATCH_DEADLINE_MS = 6000;

/** Concurrent upstream resolutions. Enough to be quick, not enough to look like an attack. */
const BATCH_CONCURRENCY = 5;

export interface GetPreviewsOptions {
  maxUpstream?: number;
  deadlineMs?: number;
}

/**
 * Resolves many tracks in one pass, keyed by the id each caller sent.
 *
 * The reason this exists is the KV bill, not the upstream one: reading a
 * 50-track game one key at a time is 50 Upstash commands and 50 round trips,
 * where `mget` is one of each. Upstream work is still bounded by the same
 * budget and cooldowns a single lookup goes through.
 */
export async function getPreviews(
  queries: PreviewQuery[],
  options: GetPreviewsOptions = {}
): Promise<Map<string, PreviewResult>> {
  const results = new Map<string, PreviewResult>();
  if (queries.length === 0) return results;

  // Several tracks can share a cache key (the same recording under two ids is
  // rare, but two id-less entries with the same name are not), so resolve each
  // key once and fan the answer back out.
  const keyed = queries.map((q) => ({
    query: q,
    key: previewCacheKey(q.id, q.track, q.artist),
  }));
  const uniqueKeys = [...new Set(keyed.map((k) => k.key))];
  const records = await readRecords(uniqueKeys);
  const byKey = new Map<string, PreviewRecord | null>(
    uniqueKeys.map((key, i) => [key, records[i]])
  );

  const resolved = new Map<string, PreviewResult>();
  const pending: Array<{ query: PreviewQuery; key: string }> = [];
  const seen = new Set<string>();
  // Counted per query rather than per key: two tracks sharing a key are two
  // questions the cache answered, and the hit rate is about questions.
  let hitCount = 0;

  for (const entry of keyed) {
    const record = byKey.get(entry.key);
    if (record) {
      resolved.set(entry.key, recordToResult(record));
      hitCount++;
    } else if (!seen.has(entry.key)) {
      seen.add(entry.key);
      pending.push(entry);
    }
  }

  const maxUpstream = options.maxUpstream ?? DEFAULT_MAX_UPSTREAM_PER_BATCH;
  const toResolve = pending.slice(0, Math.max(0, maxUpstream));
  const deferred = pending.slice(toResolve.length);

  // Claimed for the whole batch up front, so it either gets its fan-out or
  // defers cleanly instead of stopping halfway through a playlist.
  const allowed = toResolve.length > 0 && (await claimLookupBudget(toResolve.length));

  let unavailableCount = deferred.length;
  let missCount = 0;

  if (allowed) {
    const deadline = Date.now() + (options.deadlineMs ?? BATCH_DEADLINE_MS);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(BATCH_CONCURRENCY, toResolve.length) }, async () => {
        while (next < toResolve.length) {
          const entry = toResolve[next++];
          if (Date.now() > deadline) {
            resolved.set(entry.key, { previewUrl: null, status: "unavailable" });
            unavailableCount++;
            continue;
          }
          const result = await resolveAndStore(entry.query, entry.key, byKey.get(entry.key) ?? null);
          resolved.set(entry.key, result);
          missCount++;
          if (result.status === "unavailable") unavailableCount++;
        }
      })
    );
  } else {
    for (const entry of toResolve) {
      resolved.set(entry.key, { previewUrl: null, status: "unavailable" });
      unavailableCount++;
    }
  }

  // Deferred tracks are not written to KV: nothing refused them, we simply did
  // not ask, and a 90s marker would suppress the lazy lookup that is meant to
  // pick them up.
  for (const entry of deferred) {
    resolved.set(entry.key, { previewUrl: null, status: "unavailable" });
  }

  await recordOutcomes({ hits: hitCount, misses: missCount, unavailable: unavailableCount });

  for (const entry of keyed) {
    results.set(
      entry.query.id,
      resolved.get(entry.key) ?? { previewUrl: null, status: "unavailable" }
    );
  }
  return results;
}
