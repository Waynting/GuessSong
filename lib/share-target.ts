/**
 * Where something shared into the app should land (`/share`).
 *
 * Android's share intent puts the Spotify link in `text` (EXTRA_TEXT) more
 * often than `url`, usually with prefix text around it, so the route handler
 * concatenates all three params and the blob is scanned.
 *
 * The scanning is `classifySpotifyLink` and the following of a short link is
 * `resolveShortlink`. This file used to have its own copy of both — a parser
 * stricter than the server's, and a resolver with no timeout and no cache —
 * and was the only place either was any good. They are the site's now, and
 * what is left here is the one decision that is the share sheet's own: which
 * page a share ends on.
 */

import type { ShareType } from "@/lib/analytics";
import {
  classifySpotifyLink,
  isNamedLinkKind,
  playlistUrlFromId,
  type SpotifyLink,
} from "@/lib/spotify-link";
import { resolveShortlink } from "@/lib/spotify-shortlink";

export type SharedLink = SpotifyLink;

/** Classify shared text without any network I/O. */
export function parseSharedText(raw: string): SharedLink {
  return classifySpotifyLink(raw);
}

export { playlistUrlFromId };

export type ShareDestination =
  /** The setup page, with this in the playlist field. */
  | { to: "setup"; playlistUrl: string }
  /** `/share/unsupported`, which says what was shared and what to share instead. */
  | { to: "unsupported"; type: ShareType };

export interface ShareDestinationOptions {
  /**
   * False when the caller's limiter has refused this address. A short link is
   * then handed on unfollowed rather than followed anyway or thrown away.
   */
  mayResolve?: boolean;
}

/**
 * Decide where a share ends up.
 *
 * A short link that cannot be followed *right now* — we timed out, or this
 * address has asked too often — goes to the setup page as it is, still a
 * short link. The form takes one and the server follows it again on Start,
 * behind the playlist route's own limiter, so the share is delayed rather
 * than lost. Sending it to "couldn't find a playlist link" instead would be
 * the wrong null: nothing was learned about the link, and the person would
 * be told to go and share something else when what they shared was fine.
 */
export async function shareDestination(
  raw: string,
  options: ShareDestinationOptions = {}
): Promise<ShareDestination> {
  let link = classifySpotifyLink(raw);

  if (link.kind === "shortlink") {
    if (options.mayResolve === false) return { to: "setup", playlistUrl: link.url };
    const resolution = await resolveShortlink(link.url);
    if (resolution.status === "unavailable") return { to: "setup", playlistUrl: link.url };
    if (resolution.status === "unusable") return { to: "unsupported", type: "unknown" };
    link = resolution.link;
  }

  if (link.kind === "playlist") return { to: "setup", playlistUrl: playlistUrlFromId(link.id) };
  return { to: "unsupported", type: isNamedLinkKind(link.kind) ? link.kind : "unknown" };
}
