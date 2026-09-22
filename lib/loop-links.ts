/**
 * The loop: every place the product can tell a player it exists.
 *
 * Buzzer Mode already puts a phone in every hand — `app/buzz/[code]/page.tsx`
 * was 264 lines that never once contained the string "GuessSong", and
 * `app/j/[code]/page.tsx` ended at a dead confirmation screen. The expensive
 * half of a viral loop (rooms, phones, share cards) has been shipping for
 * weeks with no call to action anywhere in it. These are the surfaces that
 * close it.
 *
 * ## Why the surface name lives in exactly one place
 *
 * Each surface's name is needed in three places at once: the link's `href`,
 * the analytics param, and the server-side validator on `/r/[surface]`. Written
 * out by hand that is one string per surface per site, kept in sync by
 * discipline — and the failure mode is silent. A renamed href with a stale
 * validator does not throw; the redirect still works, the counter simply stops
 * incrementing and that arm reads as "nobody clicked it". You would then
 * correctly conclude the CTA was useless and delete a CTA that was working.
 *
 * So the union is declared once here and every consumer derives from it, the
 * same trick `lib/buzzer-protocol.ts` uses to keep the Worker and the client
 * speaking one language. This module stays dependency-free for the same reason
 * that one does: it is imported from a client component, a route handler, and
 * the KV counters, and nothing here may drag `lib/kv.ts` into a browser bundle.
 */

/**
 * Ordered so the list reads down the funnel: the two passive footers, the two
 * moments a player has just finished doing something, then the card that
 * leaves the party entirely.
 */
export const LOOP_SURFACES = [
  /** Persistent footer on the buzzer player page. Always live. */
  "buzz_footer",
  /**
   * Full-width call to action on the buzzer player page, shown only between
   * rounds. See `app/buzz/[code]/page.tsx` for why it cannot be shown at the
   * end of the game: the wire protocol has no end-of-game signal.
   */
  "buzz_cta",
  /** Persistent footer on the Mixed Playlist submit page. */
  "join_footer",
  /** The confirmation screen after a player submits their playlist. */
  "join_submitted",
  /**
   * The QR on the Game Over screen, scanned off the host's television by the
   * people who just spent half an hour buzzing at it.
   *
   * Kept separate from `share` even though both are QR codes, because they are
   * scanned by different people under different conditions — this one by a room
   * that has just played, that one by whoever a photo got forwarded to — and
   * merging them would average a warm audience with a cold one into a number
   * that describes neither.
   */
  "game_over",
  /**
   * **Retired 2026-09-22; kept so old cards still count.** The result card
   * carried a QR back to `/r/share` from 1.3.0 — the one hit that did not
   * start on a page of ours, arriving from whatever app the picture was
   * forwarded into. Over eleven weeks it was shown on 94 parties' cards and
   * followed 0 times, against 13–30% on the link-shaped arms, so the card
   * prints the address as text now (`lib/result-image.ts`) and nothing
   * reports an impression for this surface. The name stays in the union
   * because cards already saved carry the QR for as long as they exist:
   * `/r/share` must keep redirecting, and a scan of one is still worth a
   * `click:share` — which is why a `share` row with no `shown` is expected
   * here and not the "impression missing" plumbing fault `docs/viral-loop.md`
   * §7 describes for every other arm.
   */
  "share",
  /**
   * The result screen of a playlist quiz (`/q/[code]`): a friend has just
   * answered ten questions about someone's taste and is looking at a score.
   *
   * The first surface whose carrier is a URL tapped in a group chat rather
   * than a QR scanned off a screen or out of an image. Kept apart from `share`
   * even though both leave the party, because `share` had never converted
   * and the question this one exists to answer was whether that was the
   * audience or the carrier. Answered: the carrier. This arm converts
   * (13% in its first full week); the QR out of an image never did.
   */
  "quiz_result",
] as const;

export type LoopSurface = (typeof LOOP_SURFACES)[number];

/**
 * What the surfaces say. Declared here, beside the names, for the same
 * reason the names are: the same sentence was written seven different ways
 * across the pages that carry it ("Host the next one", "Scan to host your own
 * party", "Scan to play your own", …), each a small decision about what the
 * product is called and what it asks you to do. One phrase, three carriers —
 * a button, a footer line, a QR caption — is all the variation the job needs.
 * The quiz result keeps its own line in `lib/quiz-copy.ts`, because that link
 * lands on the quiz's own page (`/quiz`) and is read in two languages.
 */
/** The loud one: a button on a screen the player has just finished with. */
export const LOOP_CTA_LABEL = "Host your own game →";
/** The quiet one: a line of text at the bottom of a player page. */
export const LOOP_FOOTER_LABEL = "Made with GuessSong — host your own";
/** Under the QR code on the Game Over screen. */
export const LOOP_QR_CAPTION = "Scan to host your own game";

/**
 * Where a visitor came from, as recorded on `game_started`.
 *
 * `organic` is everything that is not one of ours, which at 100% search
 * traffic is nearly all of it — but it is also the bucket that absorbs every
 * *lost* attribution: a PWA launched from the home screen, a stripped query
 * string, a URL retyped without its path. So the loop's share of starts is a
 * floor, never a measurement, and a low number can mean "the CTA does not
 * work" or "we could not see it". Do not read it as the former alone.
 */
export type ArrivedFrom = LoopSurface | "organic";

const SURFACE_SET: ReadonlySet<string> = new Set(LOOP_SURFACES);

/** Narrows an untrusted string — a URL segment, a query param — to a surface. */
export function isLoopSurface(value: unknown): value is LoopSurface {
  return typeof value === "string" && SURFACE_SET.has(value);
}

/**
 * The link to put in an `href`. Always relative, so it works on a preview
 * deploy and on localhost without anyone configuring an origin.
 *
 * Deliberately not a full URL even though the QR code needs one: making the
 * absolute form a separate, explicit call (`loopUrl`) keeps the accident of
 * pointing an on-page link at production out of the common path.
 */
export function loopHref(surface: LoopSurface): string {
  return `/r/${surface}`;
}

/**
 * The absolute form, for a QR code.
 *
 * This is the inverse of the rule in `lib/buzzer-client.ts:78`: a room QR uses
 * `window.location.origin` because the people scanning it are in the same room
 * on the same build, and sending them to production would point them at a room
 * that does not exist there. A loop QR is the opposite — the person scanning
 * it will open the link on their own phone, keep it, and host from it weeks
 * later, so it must always point at production, never at a preview URL that
 * will be gone by then. (The result card, which carried one until 2026-09-22,
 * was the extreme case: forwarded into a group chat and scanned days later.)
 */
export function loopUrl(surface: LoopSurface): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://www.guessong.app";
  return `${base.replace(/\/$/, "")}${loopHref(surface)}`;
}

/**
 * Reads the `?ref=` the redirect route appended, for the analytics param.
 *
 * Validated rather than passed through, because `/?ref=` is a public URL and
 * anyone can put anything in it. CLAUDE.md's analytics rule is explicit that
 * user input must never reach a GA4 param — the concern there was pasted
 * playlist URLs arriving via error messages, and a hand-edited query string is
 * the same hazard with a shorter path. Anything unrecognised is `organic`.
 */
export function arrivedFrom(ref: string | null | undefined): ArrivedFrom {
  return isLoopSurface(ref) ? ref : "organic";
}
