"use client";

/**
 * Share sheet first, clipboard second — the one way a quiz link or a score
 * leaves the phone, reported as one outcome.
 *
 * Three components wrote this by hand and drifted the same day: the copy
 * button on two of them reported nothing when the clipboard was blocked,
 * while the share button next to it reported "failed". One helper, one
 * vocabulary — the same four outcomes `result_shared` uses, because "shared"
 * is the only one that provably left the device.
 */

export type ShareLinkOutcome = "shared" | "copied" | "dismissed" | "failed";

/** How long a "Copied!" label stays up. */
export const COPIED_FLASH_MS = 2000;

export interface ShareLinkData {
  url: string;
  text?: string;
  title?: string;
}

/**
 * Prefers `navigator.share`; falls back to writing `clipboardText` (the URL
 * by default) to the clipboard. Never throws.
 *
 * **A share sheet that throws is a browser with no sheet, not a dead end.**
 * Having `navigator.share` is not the same as being able to use it: in-app
 * webviews and some desktops expose the function and reject every call
 * (`NotAllowedError`, `TypeError` for data they will not take). Returning
 * "failed" there left a button that did nothing on every tap — the daily
 * challenge read 13 `failed` in one day on 2026-11-25, one device pressing
 * it again and again. Only `AbortError` is the person backing out; anything
 * else goes on to the clipboard, and "failed" means both paths refused.
 */
export async function shareLink(
  data: ShareLinkData,
  clipboardText: string = data.url
): Promise<ShareLinkOutcome> {
  try {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share(data);
        return "shared";
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") return "dismissed";
        // Fall through to the clipboard.
      }
    }
    await navigator.clipboard.writeText(clipboardText);
    return "copied";
  } catch {
    return "failed";
  }
}

/** The clipboard alone, for an explicit Copy button. Never throws. */
export async function copyLink(text: string): Promise<Extract<ShareLinkOutcome, "copied" | "failed">> {
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
