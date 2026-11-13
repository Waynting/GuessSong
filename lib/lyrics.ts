/**
 * The lyric lines behind a `lyric` quiz: looked up on LRCLIB, reduced to a
 * handful of candidate lines by `lib/lyric-fragment.ts`, cached per track.
 *
 * Server only — this reaches lib/kv.ts. The pure half (which line, and why)
 * is in lib/lyric-fragment.ts so the suite can hold it; this file is the
 * upstream call, the cache, and the two admission controls every per-track
 * upstream path in this app carries (CLAUDE.md, "Previews are per-track").
 *
 * ## The shape is lib/preview-cache.ts's, and smaller on purpose
 *
 * Same three outcomes, for the same reason:
 *
 *   found        lines worth quoting. Cached thirty days — a lyric is fixed,
 *                but the database corrects transcriptions, and the record is
 *                a snippet index that should not outlive its usefulness.
 *   absent       LRCLIB answered and has nothing usable: no record, an
 *                instrumental, or lyrics with no line that passes the filter.
 *                Cached a week.
 *   unavailable  we could not ask — throttled, out of budget, timed out.
 *                Cached ninety seconds. Never written down as `absent`.
 *
 * Smaller, because the path is cooler: a lyric is looked up once per quiz
 * *creation* and stored with the question, not once per taker per game. At a
 * few hundred quizzes a week that is a few thousand lookups, against the
 * preview path's hundreds of thousands. So there is one source, no in-flight
 * coalescing, and the budget is a plain per-minute `incr`.
 *
 * ## LRCLIB's terms, as far as they go
 *
 * The API documents no licence and no terms beyond "identify your client":
 * a `User-Agent` naming the app and a way to reach it, honour `Retry-After`
 * on a 429 or expect a temporary ban, and keep batch work sequential-ish.
 * Measured 2026-11-13: ~90 requests a minute per identified address. So the
 * header below is constant, a 429 parks every lookup for `Retry-After`
 * (clamped), and one creation asks with bounded concurrency.
 *
 * ## What is stored, exactly
 *
 * At most `LYRIC_CANDIDATES_MAX` lines per track, each already cut to
 * `QUIZ_LYRIC_MAX_CHARS` and already stripped of the song's own title and
 * credits. Never `plainLyrics` — see the header of lib/lyric-fragment.ts for
 * why the cache is a clue index and not a lyrics archive.
 */

import { foldHan } from "@/lib/cjk-fold";
import { getKvStore } from "@/lib/kv";
import { displayTitle } from "@/lib/quiz";
import { candidateLines } from "@/lib/lyric-fragment";
import { LYRIC_STATUSES, type LyricStatus } from "@/types/quiz";
import type { Track } from "@/types";

export { LYRIC_STATUSES, type LyricStatus };

export interface LyricResult {
  status: LyricStatus;
  /** Best first; empty unless `found`. */
  lines: string[];
}

interface LyricRecord {
  status: LyricStatus;
  lines: string[];
  resolvedAt: number;
}

const FOUND_TTL_SECONDS = 30 * 24 * 60 * 60;
const ABSENT_TTL_SECONDS = 7 * 24 * 60 * 60;
const UNAVAILABLE_TTL_SECONDS = 90;

const LRCLIB_BASE = "https://lrclib.net/api/get";
/** What LRCLIB asks every client to send; the contact page is how to reach us. */
export const LRCLIB_USER_AGENT = "GuessSong (https://www.guessong.app/contact)";
const UPSTREAM_TIMEOUT_MS = 2500;

/** How many tracks one creation looks up at once. Four keeps a 60-track pass inside a request. */
export const LYRIC_LOOKUP_CONCURRENCY = 4;

/**
 * The global per-minute ceiling, shared across instances through KV. LRCLIB
 * allows ~90 a minute per address and a deploy's egress addresses are shared,
 * so the default leaves room for the cache to miss on a few quizzes at once
 * and not for a scripted client. Fails open on a KV error, like every budget
 * here: losing the net must mean "as before", not "no lyric quizzes".
 */
const DEFAULT_MAX_LOOKUPS_PER_MINUTE = 60;
const BUDGET_KEY = "lyrics:budget";
const BUDGET_WINDOW_SECONDS = 60;

/** Same clamps as the preview cooldown: honest to the header, bounded either way. */
const COOLDOWN_KEY = "lyrics:cooldown";
const MIN_COOLDOWN_SECONDS = 30;
const MAX_COOLDOWN_SECONDS = 15 * 60;
const DEFAULT_COOLDOWN_SECONDS = 60;

/** A Spotify track id: exactly 22 base62 characters. Anything else gets no key, and no cache. */
const SPOTIFY_TRACK_ID = /^[A-Za-z0-9]{22}$/;

function cacheKey(id: string): string | null {
  return SPOTIFY_TRACK_ID.test(id) ? `lyrics:v1:${id}` : null;
}

function ttlFor(status: LyricStatus): number {
  if (status === "found") return FOUND_TTL_SECONDS;
  return status === "absent" ? ABSENT_TTL_SECONDS : UNAVAILABLE_TTL_SECONDS;
}

function lookupLimit(): number {
  const configured = Number(process.env.LYRICS_MAX_LOOKUPS_PER_MINUTE);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_LOOKUPS_PER_MINUTE;
}

async function claimBudget(): Promise<boolean> {
  try {
    const used = await (await getKvStore()).incr(BUDGET_KEY, BUDGET_WINDOW_SECONDS);
    return used <= lookupLimit();
  } catch {
    return true;
  }
}

/**
 * The cooldown, memoised in module scope the way lib/preview-cache.ts does
 * it: a creation asks about several tracks in one burst, and the answer is a
 * site-wide, minute-scale signal. A known-future `until` is trusted outright;
 * "not cooling" is re-read after `COOLDOWN_MEMO_MS`.
 */
const COOLDOWN_MEMO_MS = 5000;
let cooldownMemo: { until: number; readAt: number } | null = null;

async function isCoolingDown(): Promise<boolean> {
  const now = Date.now();
  if (cooldownMemo) {
    if (cooldownMemo.until > now) return true;
    if (now - cooldownMemo.readAt < COOLDOWN_MEMO_MS) return false;
  }
  let until = 0;
  try {
    const stored = await (await getKvStore()).get<number>(COOLDOWN_KEY);
    if (typeof stored === "number" && stored > now) until = stored;
  } catch {
    // Unknown is "not cooling": the budget above still bounds the burst.
  }
  cooldownMemo = { until, readAt: now };
  return until > now;
}

async function startCooldown(retryAfterSeconds?: number): Promise<void> {
  const seconds = Math.min(
    MAX_COOLDOWN_SECONDS,
    Math.max(MIN_COOLDOWN_SECONDS, retryAfterSeconds ?? DEFAULT_COOLDOWN_SECONDS)
  );
  const until = Date.now() + seconds * 1000;
  cooldownMemo = { until, readAt: Date.now() };
  try {
    await (await getKvStore()).set(COOLDOWN_KEY, until, seconds);
  } catch {
    // The memo parks this instance; the others join on their next miss.
  }
}

/** Test seam: the memo outlives a test. */
export function __resetLyricsForTests(): void {
  cooldownMemo = null;
}

function retryAfterFrom(res: Response): number | undefined {
  const raw = res.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

interface LrclibRecord {
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

type Upstream =
  | { kind: "record"; record: LrclibRecord }
  | { kind: "missing" }
  | { kind: "unavailable"; retryAfterSeconds?: number; throttled: boolean };

/**
 * One `GET /api/get`. A 404 is LRCLIB's "no such recording" and is an
 * answer; a 429 parks the source; everything else — 5xx, a timeout, a body
 * that is not JSON — is "we could not ask".
 */
async function askLrclib(query: { track: string; artist: string; durationMs?: number }): Promise<Upstream> {
  const params = new URLSearchParams({ track_name: query.track, artist_name: query.artist });
  if (query.durationMs && query.durationMs > 0) {
    params.set("duration", String(Math.round(query.durationMs / 1000)));
  }
  let res: Response;
  try {
    res = await fetch(`${LRCLIB_BASE}?${params.toString()}`, {
      headers: { "User-Agent": LRCLIB_USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return { kind: "unavailable", throttled: false };
  }
  if (res.status === 404) {
    void res.body?.cancel().catch(() => {});
    return { kind: "missing" };
  }
  if (res.status === 429) {
    void res.body?.cancel().catch(() => {});
    return { kind: "unavailable", throttled: true, retryAfterSeconds: retryAfterFrom(res) };
  }
  if (!res.ok) {
    void res.body?.cancel().catch(() => {});
    return { kind: "unavailable", throttled: false };
  }
  try {
    const body = (await res.json()) as LrclibRecord | null;
    if (!body || typeof body !== "object") return { kind: "unavailable", throttled: false };
    return { kind: "record", record: body };
  } catch {
    return { kind: "unavailable", throttled: false };
  }
}

/**
 * The spellings to try, strictest first, each a request: the title as
 * Spotify stores it, then without its qualifier ("Hello - Live" → "Hello"),
 * then both halves folded to Simplified — LRCLIB holds Joker Xue's 演员 under
 * the Simplified spelling and answers 404 to the Traditional 演員 a Taiwanese
 * playlist carries (measured 2026-11-13). Duplicates are dropped, so a track
 * that needs no fallback costs one call.
 */
export function lyricQueries(track: Pick<Track, "name" | "artists" | "durationMs">): Array<{ track: string; artist: string; durationMs?: number }> {
  const artist = Array.isArray(track.artists) && typeof track.artists[0] === "string" ? track.artists[0] : "";
  const durationMs = typeof track.durationMs === "number" && track.durationMs > 0 ? track.durationMs : undefined;
  const titles = [track.name.trim(), displayTitle(track.name)];
  const out: Array<{ track: string; artist: string; durationMs?: number }> = [];
  const seen = new Set<string>();
  const push = (t: string, a: string) => {
    const k = `${t}|${a}`;
    if (!t || seen.has(k)) return;
    seen.add(k);
    out.push({ track: t, artist: a, durationMs });
  };
  for (const t of titles) push(t, artist);
  for (const t of titles) push(foldHan(t), foldHan(artist));
  return out;
}

/** The record as the cache sees it, from what upstream said. */
function reduce(record: LrclibRecord, track: Pick<Track, "name" | "artists">): LyricResult {
  if (record.instrumental) return { status: "absent", lines: [] };
  const plain = typeof record.plainLyrics === "string" ? record.plainLyrics : "";
  const lines = candidateLines(plain, track.name, Array.isArray(track.artists) ? track.artists : []);
  return lines.length > 0 ? { status: "found", lines } : { status: "absent", lines: [] };
}

async function resolve(track: Pick<Track, "id" | "name" | "artists" | "durationMs">): Promise<LyricResult> {
  if (await isCoolingDown()) return { status: "unavailable", lines: [] };
  if (!(await claimBudget())) return { status: "unavailable", lines: [] };
  let missing = false;
  for (const query of lyricQueries(track)) {
    const answer = await askLrclib(query);
    if (answer.kind === "record") return reduce(answer.record, track);
    if (answer.kind === "missing") {
      missing = true;
      continue;
    }
    if (answer.throttled) await startCooldown(answer.retryAfterSeconds);
    return { status: "unavailable", lines: [] };
  }
  // Every spelling came back 404: a clean "not here", cached a week.
  return missing ? { status: "absent", lines: [] } : { status: "unavailable", lines: [] };
}

async function readCached(ids: string[]): Promise<Map<string, LyricResult>> {
  const out = new Map<string, LyricResult>();
  const keyed = ids.map((id) => [id, cacheKey(id)] as const).filter((e): e is readonly [string, string] => e[1] !== null);
  if (keyed.length === 0) return out;
  try {
    const records = await (await getKvStore()).mget<LyricRecord>(keyed.map(([, k]) => k));
    keyed.forEach(([id], i) => {
      const r = records[i];
      if (!r || !LYRIC_STATUSES.includes(r.status)) return;
      out.set(id, { status: r.status, lines: Array.isArray(r.lines) ? r.lines.filter((l) => typeof l === "string") : [] });
    });
  } catch {
    // A cache outage is a slower creation, not a failed one.
  }
  return out;
}

async function writeCached(id: string, result: LyricResult): Promise<void> {
  const key = cacheKey(id);
  if (!key) return;
  try {
    const record: LyricRecord = { status: result.status, lines: result.lines, resolvedAt: Date.now() };
    await (await getKvStore()).set(key, record, ttlFor(result.status));
  } catch {
    // Swallowed: the answer is already in hand.
  }
}

/**
 * The lyric candidates for a set of tracks, by track id: one `mget`, then
 * the misses looked up `LYRIC_LOOKUP_CONCURRENCY` at a time and written
 * back. Every track gets an entry, so the caller can tell `absent` from
 * `unavailable` and count each (`recordQuizLyricLookup`).
 *
 * `onLookup` is told about each upstream resolution — not cache hits — so
 * the counters describe what was spent.
 */
export async function lookupLyricCandidates(
  tracks: readonly Pick<Track, "id" | "name" | "artists" | "durationMs">[],
  onLookup?: (status: LyricStatus) => void
): Promise<Map<string, LyricResult>> {
  const byId = new Map<string, Pick<Track, "id" | "name" | "artists" | "durationMs">>();
  for (const t of tracks) if (t && typeof t.id === "string" && t.id && !byId.has(t.id)) byId.set(t.id, t);
  const results = await readCached([...byId.keys()]);
  const misses = [...byId.values()].filter((t) => !results.has(t.id));

  let next = 0;
  const worker = async () => {
    while (next < misses.length) {
      const track = misses[next];
      next += 1;
      const result = await resolve(track);
      results.set(track.id, result);
      onLookup?.(result.status);
      await writeCached(track.id, result);
    }
  };
  await Promise.all(Array.from({ length: Math.min(LYRIC_LOOKUP_CONCURRENCY, misses.length) }, worker));
  return results;
}
