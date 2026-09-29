"use client";

import { useEffect, useMemo } from "react";
import { trackEvent, type AnalyticsEvent } from "@/lib/analytics";
import { checkPlaylistLink, type PlaylistLinkCheck } from "@/lib/spotify-link";

/** The forms that gate a button on the playlist field. */
export type PlaylistLinkSurface = Extract<
  AnalyticsEvent,
  { name: "playlist_link_named" }
>["params"]["surface"];

/**
 * What a form's playlist field holds, for the four forms that will not send
 * a link the server would refuse: the join page, the buzzer's join page, the
 * pass-the-phone collector and the host's own field in the room panel.
 *
 * The reading itself is `checkPlaylistLink` — pure, in lib/spotify-link.ts,
 * where the suite can reach it. This hook is the two things that need React:
 * not re-running the classifier on every unrelated render, and reporting a
 * named link once, when the field becomes one, rather than on each keystroke
 * that leaves it one.
 *
 * Each form used to carry its own
 * `includes("spotify.com/playlist") || includes("spotify:playlist:")`, which
 * turned away `/intl-ja/playlist/…` and the old `/user/…/playlist/…` links
 * that the server has always loaded. A form that grows a check of its own
 * again is that bug again; `tests/use-playlist-link.test.ts` reads the four
 * files for it.
 */
export function usePlaylistLinkCheck(
  value: string,
  surface: PlaylistLinkSurface
): PlaylistLinkCheck {
  const check = useMemo(() => checkPlaylistLink(value), [value]);
  const { named } = check;

  useEffect(() => {
    if (named) trackEvent("playlist_link_named", { surface, link_kind: named });
  }, [named, surface]);

  return check;
}
