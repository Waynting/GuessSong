/**
 * What a host is told to do about a playlist link that will never load.
 *
 * ## Why it exists
 *
 * In the week to 2026-09-29 the site refused 2,535 links for a reason that
 * was never going to change — private or deleted 1,261, not a playlist link
 * 748, one of Spotify's own 517, empty 9 — and what each of those hosts got
 * was a red box with one sentence in it. The sentence says what is wrong. It
 * does not say what to press, and the guide that does
 * (`/guides/spotify-playlist-not-working`, which covers all of them) was one
 * search away from a person holding a phone in front of eight people.
 *
 * So each permanent refusal gets one line of what to do next and a link to
 * the part of that guide about it. Both are rendered under the sentence, in
 * the language the sentence is in.
 *
 * ## Why this is a table of codes, and a second table of topics
 *
 * `PLAYLIST_HELP_BY_CODE` maps an error code to a topic; `PLAYLIST_HELP_TOPICS`
 * holds what each topic says. Two tables because several codes are the same
 * advice — a link to an album, to a track and to an artist are three refusals
 * and one remedy — and because it makes a new code a one-line change that
 * cannot forget a translation: the line names a topic, and a topic without
 * both languages is a compile error, the same trick `ERROR_MESSAGES` uses.
 *
 * **A code is only allowed here if resubmitting the same link provably cannot
 * work.** Help for a refusal reads as "your link is the problem", and for a
 * throttled host that is an old bug back — the message that told hosts to
 * check their playlist was public while the site was out of quota. Their
 * playlist is fine, and the advice sends them off to change settings that
 * were never wrong. `tests/playlist-help.test.ts` pins both directions: no
 * throttling code in the table, and no permanent refusal missing from it.
 *
 * The sentences themselves stay in `lib/error-messages.ts`, which is still the
 * only place an *error* is worded. These are the line after it.
 */

import {
  AppError,
  describeError,
  errorMessage,
  type AppErrorCode,
  type ErrorLocale,
} from "@/lib/error-messages";
import { getGuide } from "@/lib/guides";

/** The one guide every topic below points into. */
export const PLAYLIST_GUIDE_SLUG = "spotify-playlist-not-working";

export type PlaylistHelpTopic = "editorial" | "private" | "wrong_link" | "empty";

export interface PlaylistHelpCopy {
  /**
   * The `id` of the guide's section about this, or null to link to the top of
   * the guide.
   *
   * Every one is null today because the guide's headings carry no ids — a
   * link to `#private-playlist` would land at the top anyway, and silently.
   * When the headings grow ids, put them here; the test reads the guide's
   * source and fails on an anchor the guide does not have, so this cannot
   * name a section that was since renamed.
   */
  anchor: string | null;
  /** What to do next. One sentence, and something the host can do on the spot. */
  step: Record<ErrorLocale, string>;
  /** The link's text: what the guide section will tell them. No arrow — the renderer adds it. */
  label: Record<ErrorLocale, string>;
}

export const PLAYLIST_HELP_TOPICS: Record<PlaylistHelpTopic, PlaylistHelpCopy> = {
  editorial: {
    anchor: null,
    step: {
      en: "Copy the songs into a playlist of your own, make it public, and paste that link instead.",
      zh: "把裡面的歌加進你自己的歌單，設成公開，再貼上那個歌單的連結。",
    },
    label: {
      en: "How to copy a Spotify playlist",
      zh: "怎麼複製官方歌單",
    },
  },
  private: {
    anchor: null,
    // "Make it public", not the menu item's name. The guide this links to
    // says the wording differs by app version, and a step that quotes a label
    // the host cannot find is worse than one that says what the label does.
    step: {
      en: "In Spotify, open the playlist's ⋯ menu and make it public, then copy the link again.",
      zh: "在 Spotify 打開這個歌單的「⋯」選單，把它設成公開，再重新複製連結。",
    },
    label: {
      en: "How to make a playlist public",
      zh: "怎麼把歌單設成公開",
    },
  },
  wrong_link: {
    anchor: null,
    step: {
      en: "Open the playlist itself in Spotify, choose Share → Copy link, and paste that.",
      zh: "在 Spotify 打開歌單本身，按「分享」→「複製連結」，再貼到這裡。",
    },
    label: {
      en: "What a playlist link looks like",
      zh: "歌單連結長什麼樣子",
    },
  },
  empty: {
    anchor: null,
    step: {
      en: "Add songs to it in Spotify first — files from your own device don't count — or paste a different playlist.",
      zh: "先在 Spotify 把歌加進去（自己裝置上的本機檔案不算），或是換一個歌單。",
    },
    label: {
      en: "Why a playlist can come back empty",
      zh: "為什麼歌單會是空的",
    },
  },
};

/**
 * Which refusals get help, and which help.
 *
 * `Partial` because most codes are not about a link at all. Adding a refusal
 * is one line here — `some_new_code: "wrong_link",` — and the test fails until
 * it is added for any code `isDeterministicPlaylistFailure` names, so a new
 * permanent refusal cannot ship as a bare sentence by being forgotten.
 *
 * `missing_playlist_url` and `playlist_url_required` are deliberately absent:
 * they are an empty field, and there is nothing to look up about a link that
 * has not been pasted yet.
 */
export const PLAYLIST_HELP_BY_CODE: Partial<Record<AppErrorCode, PlaylistHelpTopic>> = {
  playlist_editorial: "editorial",
  playlist_not_found: "private",
  invalid_playlist_url: "wrong_link",
  playlist_link_album: "wrong_link",
  playlist_link_track: "wrong_link",
  playlist_link_artist: "wrong_link",
  playlist_empty: "empty",
};

/** The topic for a code, or null for every code that is not a permanent refusal. */
export function playlistHelpTopic(code: unknown): PlaylistHelpTopic | null {
  if (typeof code !== "string") return null;
  // `hasOwnProperty`, not a plain index: the code can arrive from a response
  // body, and `PLAYLIST_HELP_BY_CODE["constructor"]` is a function.
  if (!Object.prototype.hasOwnProperty.call(PLAYLIST_HELP_BY_CODE, code)) return null;
  return PLAYLIST_HELP_BY_CODE[code as AppErrorCode] ?? null;
}

/**
 * Whether this refusal is one the host can only get past with a different
 * link. The same question as "does it have help", asked by name because the
 * starter playlists are offered on exactly these and must not drift from them.
 */
export function isPermanentRefusal(code: unknown): boolean {
  return playlistHelpTopic(code) !== null;
}

/** Where a topic's link goes, or null if the guide has been retired. */
export function playlistHelpHref(topic: PlaylistHelpTopic): string | null {
  // Through `getGuide`, the way the homepage's guide cards are: a retired
  // slug costs the link and keeps the step, instead of sending a host who is
  // already stuck to a 404.
  const guide = getGuide(PLAYLIST_GUIDE_SLUG);
  if (!guide) return null;
  const anchor = PLAYLIST_HELP_TOPICS[topic].anchor;
  return `/guides/${guide.slug}${anchor ? `#${anchor}` : ""}`;
}

export interface PlaylistHelp {
  step: string;
  label: string;
  href: string | null;
}

/** Everything the page renders under a refusal, in the reader's language. */
export function playlistHelp(code: unknown, locale: ErrorLocale): PlaylistHelp | null {
  const topic = playlistHelpTopic(code);
  if (!topic) return null;
  const copy = PLAYLIST_HELP_TOPICS[topic];
  return {
    step: copy.step[locale],
    label: copy.label[locale],
    href: playlistHelpHref(topic),
  };
}

/**
 * The warning under the field when the link typed is one of Spotify's own.
 *
 * It used to read "may not work". The server refuses these every single time
 * — 517 of them in a week — so "may" was a sentence that let a host press
 * Start to find out, and then told them. The refusal's own sentence is reused
 * rather than reworded, so the warning and the error a host gets for ignoring
 * it cannot come to say different things; what is added is the way out.
 */
export function editorialWarning(locale: ErrorLocale): { notice: string } & PlaylistHelp {
  return {
    notice: errorMessage("playlist_editorial", locale),
    // Non-null: `playlist_editorial` is in the table above, and the test pins it.
    ...(playlistHelp("playlist_editorial", locale) as PlaylistHelp),
  };
}

/**
 * A failure as the setup page holds it: the sentence, and the code it came
 * from.
 *
 * The page used to keep the sentence alone, which is all a red box needs and
 * is exactly what made the box a dead end — by the time it was on screen,
 * nothing knew *which* refusal it was, so nothing could say what to do about
 * it. The rejection memo keeps the same pair, so a refusal replayed without a
 * request is the same box with the same help under it.
 */
export interface SetupFailure {
  code: AppErrorCode;
  message: string;
}

/** For a validation the page raises itself. */
export function failureFor(
  code: AppErrorCode,
  locale: ErrorLocale,
  params?: Record<string, string | number>
): SetupFailure {
  return { code, message: errorMessage(code, locale, params ? { params } : {}) };
}

/**
 * For anything a `catch` caught. A throw with no code — a dropped connection,
 * a JSON parse failure — takes `fallback` as its code as well as its sentence,
 * and no fallback a caller passes is a permanent refusal, so "we don't know
 * what went wrong" never comes with advice about the link.
 */
export function failureOf(
  err: unknown,
  locale: ErrorLocale,
  fallback: AppErrorCode
): SetupFailure {
  return {
    code: err instanceof AppError ? err.code : fallback,
    message: describeError(err, locale, fallback),
  };
}
