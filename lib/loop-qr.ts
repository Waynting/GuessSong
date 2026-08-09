/**
 * A QR back to the site, as a data URL.
 *
 * Its own module rather than a helper on `lib/loop-client.ts` because that one
 * is imported by the setup page, and `qrcode` has no business in the bundle of
 * the page that takes essentially all of this site's search traffic. Only the
 * two places that actually draw a code pull this in.
 */

import QRCode from "qrcode";
import { loopUrl, type LoopSurface } from "@/lib/loop-links";

/**
 * Returns null rather than throwing.
 *
 * Both callers are in the middle of giving someone something they asked for —
 * a picture of their scores, a celebration screen — and neither should fail
 * over a decoration. The caller falls back to printing the address as text.
 */
export async function loopQrDataUrl(
  surface: LoopSurface = "share",
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
