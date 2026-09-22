/**
 * A QR back to the site, as a data URL.
 *
 * Its own module rather than a helper on `lib/loop-client.ts` because that one
 * is imported by the setup page, and `qrcode` has no business in the bundle of
 * the page that takes essentially all of this site's search traffic. Only the
 * one place that actually draws a code (`components/loop-qr.tsx`, the Game
 * Over screen) pulls this in; the result card drew one too until the
 * `share` arm read 0 of 94 and was retired (`lib/result-image.ts`).
 */

import QRCode from "qrcode";
import { loopUrl, type LoopSurface } from "@/lib/loop-links";

/**
 * Returns null rather than throwing.
 *
 * The caller is in the middle of giving someone a celebration screen and
 * should not fail over a decoration; it falls back to printing the address
 * as text. The surface is required — a default of `"share"` is how a card
 * would quietly grow its retired QR back.
 */
export async function loopQrDataUrl(
  surface: LoopSurface,
  pixels = 240
): Promise<string | null> {
  try {
    return await QRCode.toDataURL(loopUrl(surface), {
      margin: 1,
      width: pixels,
      // Dark modules on white. The cards are near-black, so a transparent or
      // inverted code would be unreadable to half the scanners that see it —
      // the quiet zone has to be light for the pattern to be found at all.
      color: { dark: "#000000", light: "#ffffff" },
    });
  } catch {
    return null;
  }
}
