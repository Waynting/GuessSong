/**
 * Following a `spotify.link` short link to what it names.
 *
 * Spotify's mobile share sheet hands some people a short link instead of the
 * playlist's address, and the browser cannot follow it — the redirector sends
 * no CORS headers — so until this existed a short link pasted into any form
 * was refused as "not a playlist link" about a link Spotify had just produced.
 * Only the Android share target resolved one, with no timeout and no cache.
 *
 * Server-only: this is network and KV. Whether a string *is* a short link is
 * `classifySpotifyLink` in `lib/spotify-link.ts`, which the browser can load.
 *
 * ## The three answers are not the same null
 *
 * The rule `lib/preview-cache.ts` is built around, for the same reason:
 *
 *   resolved     the redirector named a playlist, album, track or artist
 *   unusable     it answered cleanly, and named none of those — a fact about
 *                the link, so the refusal is permanent
 *   unavailable  a fact about *us*: we timed out, the connection dropped, or
 *                the reply was neither a redirect nor an interstitial page
 *                naming one destination. Nothing was learned about the
 *                link, so the caller must be able to ask again
 *
 * Only a clean reply may produce `unusable`. Everything that is not one is
 * `unavailable`, because the two mistakes are not the same size: a wrong
 * `unavailable` costs one retry, and a wrong `unusable` tells a host their
 * working link is broken and — through `isDeterministicPlaylistFailure` —
 * stops their Start button from asking again.
 *
 * ## It spends none of Spotify's API quota
 *
 * The redirector is not the Web API and is not metered against the client id,
 * so none of `lib/playlist-cache.ts`'s budgets apply and none is claimed. It
 * is still an outbound request per new link, which is why every caller sits
 * behind a route limiter and why the answer is cached.
 */

import { getKvStore } from "@/lib/kv";
import { recordShortlinkOutcome } from "@/lib/loop-stats";
import {
  classifySpotifyLink,
  isSpotifyShortlinkHost,
  type SpotifyLink,
} from "@/lib/spotify-link";

/** What a short link can turn out to be. Never another short link. */
export type ResolvedLink = Exclude<SpotifyLink, { kind: "shortlink" } | { kind: "unknown" }>;

export type ShortlinkResolution =
  | { status: "resolved"; link: ResolvedLink }
  | { status: "unusable" }
  | { status: "unavailable" };

type SettledResolution = Exclude<ShortlinkResolution, { status: "unavailable" }>;

const CACHE_VERSION = "v1";

/**
 * A short link's destination is fixed when it is minted, so a day is not
 * about freshness — it is how long a link keeps being pasted: the host who
 * retries, the room of phones handed the same one, tonight and tomorrow
 * night. Longer would be one more key per link held for no reader.
 */
const RESOLVED_TTL_SECONDS = 24 * 60 * 60;

/**
 * Much shorter, for the reason `NOT_FOUND_TTL_SECONDS` is. This is the answer
 * that turns a host away, and it rests on reading somebody else's redirector
 * correctly; ten minutes absorbs the burst of retries a refused paste
 * generates and then lets the question be asked again.
 */
const UNUSABLE_TTL_SECONDS = 10 * 60;

/**
 * For the whole resolution, not per hop. The host is waiting on this *and
 * then* on Spotify, and a redirector that has not answered in three seconds
 * is not going to make the party's evening by answering in nine.
 */
const SHORTLINK_TIMEOUT_MS = 3000;

/**
 * One hop is the ordinary case. The bound is for a redirector that points at
 * itself, which would otherwise be a loop run on our function time.
 */
const MAX_HOPS = 3;

/** A redirect target longer than this is not one we follow. */
const HOP_URL_MAX = 2048;

/**
 * Who we say we are, and the wording is load-bearing. Branch — the service
 * behind both short-link hosts — decides per User-Agent whether to answer
 * with a redirect or with its JavaScript interstitial page, and Node's
 * default `User-Agent: node` is read as a browser: `spotify.link` answered
 * 307 to `spotify.app.link`, which answered a 200 page, and every short link
 * pasted in production came back `unavailable` (6 of 6 the first day). Named
 * as a crawler, the same link is one 307 straight to `open.spotify.com`
 * (measured 2026-10-01). Branch's rule is not ours to rely on, so the
 * interstitial is also read — see `fromInterstitial`.
 */
const SHORTLINK_USER_AGENT = "Mozilla/5.0 (compatible; GuessSongBot/1.0; +https://www.guessong.app)";

/**
 * How much of an interstitial is read. Branch's page is ~8 KB with the
 * destination two thirds of the way down; this is room for it to grow, and
 * a bound on what a redirector can make us download.
 */
const INTERSTITIAL_MAX_BYTES = 64 * 1024;

/** A destination as the interstitial spells it. No lookbehind; bounded. */
const DESTINATION_RE = /https:\/\/open\.spotify\.com\/[^\s"'<>\\]{1,2048}/g;

function cacheKey(url: string): string {
  // `url` is the classifier's rebuild — lower-cased host, one slug — so two
  // spellings of one link share an entry. The slug keeps its case: it is
  // case-sensitive upstream.
  return `shortlink:${CACHE_VERSION}:${url.slice("https://".length)}`;
}

/**
 * Reads a cached answer back as one of the two shapes that may be stored,
 * and as nothing otherwise. The value comes out of KV untyped, and what is
 * returned here is handed to the playlist path as a playlist id.
 */
function settled(value: unknown): SettledResolution | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as { status?: unknown; link?: unknown };
  if (entry.status === "unusable") return { status: "unusable" };
  if (entry.status !== "resolved" || !entry.link || typeof entry.link !== "object") return null;

  const link = entry.link as { kind?: unknown; id?: unknown };
  if (link.kind === "album" || link.kind === "track" || link.kind === "artist") {
    return { status: "resolved", link: { kind: link.kind } };
  }
  if (link.kind === "playlist" && typeof link.id === "string" && /^[A-Za-z0-9]{22}$/.test(link.id)) {
    return { status: "resolved", link: { kind: "playlist", id: link.id } };
  }
  return null;
}

async function readCache(url: string): Promise<SettledResolution | null> {
  try {
    const store = await getKvStore();
    return settled(await store.get<unknown>(cacheKey(url)));
  } catch {
    // Fail open: a cache that cannot be read is a link that gets followed.
    return null;
  }
}

async function writeCache(url: string, resolution: SettledResolution): Promise<void> {
  try {
    const store = await getKvStore();
    await store.set(
      cacheKey(url),
      resolution,
      resolution.status === "resolved" ? RESOLVED_TTL_SECONDS : UNUSABLE_TTL_SECONDS
    );
  } catch {
    // Swallowed: the caller already has its answer.
  }
}

/**
 * Where a redirect points, if that is somewhere this module will make a
 * request to: https, one of Spotify's short-link hosts, nothing else in the
 * authority. Anything that fails is classified as text instead and never
 * fetched — a redirect must not be able to aim this function at a host of
 * its choosing.
 */
function nextHop(location: string, from: string): string | null {
  let target: URL;
  try {
    target = new URL(location, from);
  } catch {
    return null;
  }
  if (target.protocol !== "https:") return null;
  if (target.username || target.password || target.port) return null;
  if (!isSpotifyShortlinkHost(target.hostname)) return null;
  const href = target.toString();
  return href.length <= HOP_URL_MAX ? href : null;
}

/** At most `max` bytes of a body, decoded. Throws on abort, like `text()`. */
async function readCapped(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < max) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(Math.min(size, max));
  let at = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes.length - at);
    bytes.set(part, at);
    at += part.length;
    if (at >= bytes.length) break;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * The destination a Branch interstitial names, or null.
 *
 * The page sends the browser on with `window.top.location =
 * validateProtocol("https://open.spotify.com/playlist/…")` and repeats the
 * address in an "open this link" anchor. Every `open.spotify.com` address in
 * the page is classified, and the answer is taken only when all the ones
 * that name music agree — a page that names two things, or none, has told
 * us nothing, and the caller treats that as `unavailable`, never `unusable`:
 * a dead link's page (it points at the app store) looks the same to a
 * reader as a page whose markup moved.
 */
function fromInterstitial(html: string): ResolvedLink | null {
  let found: ResolvedLink | null = null;
  for (const match of html.matchAll(DESTINATION_RE)) {
    const link = classifySpotifyLink(match[0]);
    if (link.kind === "unknown" || link.kind === "shortlink") continue;
    if (!found) {
      found = link;
      continue;
    }
    const same =
      found.kind === link.kind &&
      (found.kind !== "playlist" || (link.kind === "playlist" && found.id === link.id));
    if (!same) return null;
  }
  return found;
}

async function follow(start: string): Promise<ShortlinkResolution> {
  // One deadline across every hop — see SHORTLINK_TIMEOUT_MS.
  const signal = AbortSignal.timeout(SHORTLINK_TIMEOUT_MS);
  let current = start;

  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    let res: Response;
    try {
      res = await fetch(current, {
        // Manual, and that is the design. `follow` would go on to download
        // the playlist's whole web page to learn an address the redirect
        // already spelled out, and would go wherever the chain led; read
        // off `Location`, the answer costs one small request and the only
        // hosts ever contacted are the ones `nextHop` admits.
        redirect: "manual",
        cache: "no-store",
        headers: { "user-agent": SHORTLINK_USER_AGENT },
        signal,
      });
    } catch {
      // Timed out, or never connected.
      return { status: "unavailable" };
    }

    if (res.status === 200 && /text\/html/i.test(res.headers.get("content-type") ?? "")) {
      // Branch's interstitial: the redirect, written as a page. Read under
      // the same deadline, and only so far.
      let html: string;
      try {
        html = await readCapped(res, INTERSTITIAL_MAX_BYTES);
      } catch {
        return { status: "unavailable" };
      }
      const link = fromInterstitial(html);
      return link ? { status: "resolved", link } : { status: "unavailable" };
    }

    // Otherwise the body is never read; hand the socket back rather than
    // leave it to the garbage collector.
    void res.body?.cancel().catch(() => {});

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      // A redirect to nowhere is a broken reply, not a statement about the link.
      if (!location) return { status: "unavailable" };

      const onward = nextHop(location, current);
      if (onward) {
        current = onward;
        continue;
      }

      const link = classifySpotifyLink(location);
      if (link.kind === "unknown" || link.kind === "shortlink") {
        // Followed, and it leads to something that is not music a game can
        // be built from: a podcast, a profile, a download page.
        return { status: "unusable" };
      }
      return { status: "resolved", link };
    }

    // The redirector's own "no such link".
    if (res.status === 404 || res.status === 410) return { status: "unusable" };

    // Everything else: a 200 that is not a page, a 403, 429 or 5xx — the
    // redirector refusing or failing. None of them says anything about where
    // the link goes.
    return { status: "unavailable" };
  }

  return { status: "unavailable" };
}

/**
 * Follow a short link, from cache when it has been followed before.
 *
 * `url` must be the `url` of a `shortlink` classification. It is classified
 * again here rather than trusted, because this is the function that makes the
 * request: whatever reaches `fetch` has been rebuilt from a strictly matched
 * host and a single slug, whoever the caller was.
 */
export async function resolveShortlink(url: string): Promise<ShortlinkResolution> {
  const link = classifySpotifyLink(url);
  if (link.kind !== "shortlink") return { status: "unusable" };

  const cached = await readCache(link.url);
  const resolution = cached ?? (await follow(link.url));
  // `unavailable` is never stored: it describes a moment that has passed.
  if (!cached && resolution.status !== "unavailable") await writeCache(link.url, resolution);

  await recordShortlinkOutcome(resolution.status);
  return resolution;
}
