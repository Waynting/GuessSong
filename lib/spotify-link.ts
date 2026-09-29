/**
 * What a pasted string is, as far as Spotify is concerned.
 *
 * ## Why there is exactly one of these
 *
 * There used to be three readings of a playlist link and they disagreed. The
 * server (`parsePlaylistUrl`) ran two unanchored regexes with no host check
 * and no length check on the id. Six client surfaces ran
 * `includes("spotify.com/playlist")`. The Android share target had a third,
 * stricter parser of its own. The cost of the disagreement was on the one loop
 * surface that converts: a `/intl-ja/playlist/…` link, which the server has
 * always accepted, could not be submitted from the join page at all — the
 * button stayed disabled, nothing said why, and nothing counted it.
 *
 * So this is the only place a string becomes a playlist id, the same rule
 * `fold()` in `lib/room.ts` and `titleKey` in `lib/quiz.ts` follow, for the same
 * reason: two spellings of one rule is a link that is valid on one side of the
 * wire and invalid on the other. `parsePlaylistUrl`, `lib/share-target.ts`,
 * `lib/playlist-cache.ts` and every form are built on `classifySpotifyLink`.
 *
 * ## Why it must stay pure
 *
 * It is imported by client components, so it must not reach `lib/kv.ts`,
 * `lib/playlist-cache.ts` or anything that does — the reason `types/preview.ts`
 * exists. Following a short link is network and KV, and lives in
 * `lib/spotify-shortlink.ts`; this module only says that a string *is* one.
 *
 * ## Why the regexes look the way they do
 *
 * No lookbehind, anywhere. Safari before 16.4 does not parse one, and a regex
 * literal it cannot parse is a SyntaxError for the whole module — on the join
 * page that is a phone that scanned a QR and got the crash screen, which is
 * the failure `mintPlayerId()` was written to end. The boundary in front of
 * the host is a consumed character instead.
 */

import type { AppErrorCode } from "@/lib/error-messages";

export type SpotifyLink =
  | { kind: "playlist"; id: string }
  /** `url` is rebuilt from the host and the slug, never the pasted text. */
  | { kind: "shortlink"; url: string }
  | { kind: "track" }
  | { kind: "album" }
  | { kind: "artist" }
  | { kind: "unknown" };

export type SpotifyLinkKind = SpotifyLink["kind"];

/** The three kinds that are real Spotify links to something that is not a playlist. */
export type NamedLinkKind = "album" | "track" | "artist";

/**
 * The hosts Spotify's share sheets mint short links on. `spotify.link` is the
 * one the mobile app produces today; `spotify.app.link` is the Branch domain
 * it replaced, still live in older messages.
 *
 * Matched exactly, because `lib/spotify-shortlink.ts` makes a request to
 * whatever this admits.
 */
export const SPOTIFY_SHORTLINK_HOSTS: readonly string[] = ["spotify.link", "spotify.app.link"];

export function isSpotifyShortlinkHost(hostname: string): boolean {
  return SPOTIFY_SHORTLINK_HOSTS.includes(hostname.toLowerCase());
}

/**
 * How much of a paste is read. A link with its share text is a couple of
 * hundred characters; this is a bound on regex work over a string an
 * unauthenticated caller hands to three routes, the same reasoning as
 * `PREVIEW_FIELD_MAX`. Sliced by UTF-16 unit, which would be wrong for a value
 * that is encoded afterwards — nothing here is: only ASCII is ever captured.
 */
const LINK_INPUT_MAX = 2048;

/**
 * Exactly 22 base62 characters, and then not a 23rd.
 *
 * The server used to take `[a-zA-Z0-9]+`, so `…/playlist/abc` went upstream to
 * be told it was nothing — one call against a quota every visitor shares, and
 * Spotify answers a malformed id with a 400, which is neither cached nor
 * deterministic, so every retry spent another. Every id Spotify issues is this
 * shape; refusing the rest here costs nothing real and saves the call.
 */
const ID = "([A-Za-z0-9]{22})(?![A-Za-z0-9])";

/**
 * The start of the text, or a character that cannot be part of a hostname.
 * Stands in for a lookbehind (see the header) and is what makes the host
 * check a host check: without it `notopen.spotify.com` would pass.
 */
const EDGE = "(?:^|[^A-Za-z0-9.-])";

/**
 * Everything that may sit between the host and the kind:
 *
 *   /intl-ja/          the locale prefix the web player adds outside the US
 *   /embed/            the embed player's address
 *   /user/<name>/      how playlist links were written before 2018
 *
 * `play.spotify.com` is the web player's old host. All of these reached the
 * server's unanchored regex and loaded, so all of them still have to.
 */
const WEB =
  `${EDGE}(?:open|play)\\.spotify\\.com` +
  "(?:/intl-[\\w-]{2,16})?(?:/embed)?(?:/user/[^/\\s?#]{1,128})?/";

/** `spotify:playlist:<id>`, and the `spotify:user:<name>:playlist:<id>` before it. */
const URI = `${EDGE}spotify:(?:user:[^:\\s]{1,128}:)?`;

function matcher(kind: string): RegExp {
  return new RegExp(`(?:${WEB}${kind}/|${URI}${kind}:)${ID}`, "i");
}

const PLAYLIST_RE = matcher("playlist");
const TRACK_RE = matcher("track");
const ALBUM_RE = matcher("album");
const ARTIST_RE = matcher("artist");

/**
 * One slug segment and nothing after it. The scheme is optional because the
 * request is made to an address built here, not to what was pasted.
 */
const SHORTLINK_RE = new RegExp(
  `${EDGE}(?:https?://)?(${SPOTIFY_SHORTLINK_HOSTS.map((h) => h.replace(/\./g, "\\.")).join("|")})` +
    "/([\\w-]{1,64})(?![\\w-])",
  "i"
);

/**
 * Classify anything a person might paste or share, without any network I/O.
 *
 * Scans rather than anchors: Android's share intent wraps the link in a
 * sentence, and a paste from a chat brings its surroundings with it.
 *
 * The order is a decision. A playlist link wins over everything else in the
 * same text, because it is the one thing that can be played. A short link
 * comes next because it may well *be* a playlist — it has to be followed to
 * find out — and only then the three kinds that certainly are not.
 */
export function classifySpotifyLink(raw: unknown): SpotifyLink {
  if (typeof raw !== "string") return { kind: "unknown" };
  const text = raw.slice(0, LINK_INPUT_MAX);

  const playlist = text.match(PLAYLIST_RE);
  if (playlist) return { kind: "playlist", id: playlist[1] };

  const shortlink = text.match(SHORTLINK_RE);
  if (shortlink) {
    return { kind: "shortlink", url: `https://${shortlink[1].toLowerCase()}/${shortlink[2]}` };
  }

  if (TRACK_RE.test(text)) return { kind: "track" };
  if (ALBUM_RE.test(text)) return { kind: "album" };
  if (ARTIST_RE.test(text)) return { kind: "artist" };
  return { kind: "unknown" };
}

/** The playlist id in a pasted string, or null. Never follows a short link. */
export function playlistIdFromLink(raw: unknown): string | null {
  const link = classifySpotifyLink(raw);
  return link.kind === "playlist" ? link.id : null;
}

/** The one spelling of a playlist's address this app writes. */
export function playlistUrlFromId(id: string): string {
  return `https://open.spotify.com/playlist/${id}`;
}

/**
 * Spotify's own playlists — editorial and algorithmic — have ids that begin
 * `37i9`, and since November 2024 the API answers 404 for them to any app
 * registered after that. Refused, not broken: nothing a host does to the
 * link changes it.
 */
export function isEditorialPlaylistId(id: string): boolean {
  return id.startsWith("37i9");
}

/**
 * The same question asked of a pasted string. Reads the id, not the text:
 * `includes("37i9")` — what the setup page ran — also fires on a `?si=` token
 * that happens to contain it, and on an ordinary id with it in the middle.
 */
export function isEditorialPlaylistLink(raw: unknown): boolean {
  const id = playlistIdFromLink(raw);
  return id !== null && isEditorialPlaylistId(id);
}

/**
 * Whether a form may send this to the server.
 *
 * A short link counts: the server follows it (`lib/spotify-shortlink.ts`), and
 * the page cannot — `spotify.link` sends no CORS headers — so the form has to
 * let it through unresolved. An editorial playlist counts too, deliberately.
 * The server refuses it with its own sentence and *counts* the refusal
 * (`playlist_refused:playlist_editorial`); stopping it in the browser would
 * make that weekly figure fall for a reason that has nothing to do with what
 * hosts are pasting.
 */
export function isSubmittablePlaylistLink(raw: unknown): boolean {
  const kind = classifySpotifyLink(raw).kind;
  return kind === "playlist" || kind === "shortlink";
}

/**
 * The sentence for each kind of link that is a real Spotify link to the
 * wrong thing. Declared here, beside the classifier, because the server
 * (`lib/playlist-cache.ts`) and the forms both render from it and must not
 * be able to name the same link two ways.
 */
export const NAMED_LINK_CODES = {
  album: "playlist_link_album",
  track: "playlist_link_track",
  artist: "playlist_link_artist",
} as const satisfies Record<NamedLinkKind, AppErrorCode>;

export type NamedLinkCode = (typeof NAMED_LINK_CODES)[NamedLinkKind];

export function isNamedLinkKind(kind: SpotifyLinkKind): kind is NamedLinkKind {
  return kind === "album" || kind === "track" || kind === "artist";
}

export interface PlaylistLinkCheck {
  /** The server would take this. What a form's button is gated on. */
  submittable: boolean;
  /**
   * What to say under the field, as a code for `errorMessage`, or null when
   * there is nothing to say: the field is blank, or the link is fine.
   */
  problem: NamedLinkCode | "invalid_playlist_url" | null;
  /** Set when the link is an album, a track or an artist page. */
  named: NamedLinkKind | null;
}

/**
 * Everything a playlist field needs to know about what is in it.
 *
 * A form used to have one bit — valid or not — and a button that went grey
 * without a word when it was not. Whoever pasted an album link on the join
 * page had no way to learn that the link worked and was simply the wrong
 * kind. `problem` is never null for a non-blank value the server would
 * refuse, so a disabled button always has its reason beside it.
 *
 * Blank is silent: an empty field is not a mistake yet.
 */
export function checkPlaylistLink(raw: unknown): PlaylistLinkCheck {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { submittable: false, problem: null, named: null };
  }
  const { kind } = classifySpotifyLink(raw);
  if (kind === "playlist" || kind === "shortlink") {
    return { submittable: true, problem: null, named: null };
  }
  if (isNamedLinkKind(kind)) {
    return { submittable: false, problem: NAMED_LINK_CODES[kind], named: kind };
  }
  return { submittable: false, problem: "invalid_playlist_url", named: null };
}
