"use client";

/**
 * The way out of a player-facing page and back into hosting your own game.
 *
 * Both join pages ended without one for months: `app/buzz/[code]/page.tsx` was
 * 264 lines that never contained the string "GuessSong", and `app/j/[code]`
 * finished at a confirmation card with nowhere to go. Every party put four or
 * five phones on those pages and told none of them what the thing was called.
 *
 * ## Why the link is a real navigation
 *
 * `href` goes to `/r/[surface]`, which counts the hit and redirects. It has to
 * be a genuine link, not a click handler that reports and then routes: the
 * browser cancels in-flight requests as a page tears down, so a background
 * report fired on the click that leaves the page is exactly the report most
 * likely to be lost. Making the navigation itself the measurement leaves
 * nothing to cancel. That is also why `<a>` rather than `next/link` — this is a
 * server round trip on purpose, and prefetching a counting endpoint would
 * inflate it with hits nobody made.
 */

import { useEffect } from "react";
import { loopHref, type LoopSurface } from "@/lib/loop-links";
import { reportLoopClick, reportLoopImpression } from "@/lib/loop-client";

/**
 * The behaviour, without any opinion about how it looks.
 *
 * Exists because `app/game/page.tsx` styles everything with inline styles and
 * `<style>` blocks while the join pages use Tailwind, so a single styled
 * component cannot serve both. The part worth sharing is the part that can
 * silently break — the surface name, the impression, the click — and that is
 * all in here.
 */
export function useLoopSurface(
  surface: LoopSurface,
  /**
   * False while the surface is rendered but not actually visible — the buzzer
   * page keeps its call to action mounted and hidden between rounds so that
   * showing it cannot shove the buzz button down the screen at the exact
   * moment someone is about to hit it. An impression for a hidden element
   * would inflate the denominator and depress every rate built on it.
   */
  active = true
): { href: string; onClick: () => void } {
  useEffect(() => {
    if (active) reportLoopImpression(surface);
  }, [surface, active]);

  return {
    href: loopHref(surface),
    onClick: () => reportLoopClick(surface),
  };
}

/**
 * The quiet one. A line of text at the bottom of a page saying what this is.
 *
 * Its job is mostly not to be a call to action: it is there so that a player
 * who wondered "what am I even looking at" has an answer, and so the brand
 * appears at all on the pages most people see.
 */
export function LoopFooter({ surface }: { surface: LoopSurface }) {
  const { href, onClick } = useLoopSurface(surface);
  return (
    <p className="pt-2 text-center text-xs text-muted-foreground">
      <a
        href={href}
        onClick={onClick}
        className="underline-offset-4 hover:underline"
      >
        Played with <span className="font-semibold">GuessSong</span> — host your own
      </a>
    </p>
  );
}

/**
 * The loud one. Shown at the moments a player has just finished doing
 * something and is looking at a screen with nothing left on it.
 */
export function LoopCtaButton({
  surface,
  children,
  /**
   * When false the button keeps its space and stops existing for the user.
   *
   * Reserving the height rather than unmounting is the point: on the buzzer
   * page this sits under a button the player is about to slam, and appearing
   * between rounds would move that button a centimetre at the worst possible
   * moment. Hidden, it reports no impression and cannot be tabbed to.
   */
  active = true,
}: {
  surface: LoopSurface;
  children: React.ReactNode;
  active?: boolean;
}) {
  const { href, onClick } = useLoopSurface(surface, active);
  return (
    <a
      href={href}
      onClick={onClick}
      aria-hidden={!active}
      tabIndex={active ? undefined : -1}
      className={`flex h-12 w-full items-center justify-center rounded-md bg-[#1DB954] px-4 text-base font-semibold text-black transition-opacity ${
        active ? "opacity-100 hover:opacity-90" : "pointer-events-none opacity-0"
      }`}
    >
      {children}
    </a>
  );
}
