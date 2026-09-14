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
 */
export async function shareLink(
  data: ShareLinkData,
  clipboardText: string = data.url
): Promise<ShareLinkOutcome> {
  try {
    if (typeof navigator.share === "function") {
      await navigator.share(data);
      return "shared";
    }
    await navigator.clipboard.writeText(clipboardText);
    return "copied";
  } catch (e: unknown) {
    return e instanceof Error && e.name === "AbortError" ? "dismissed" : "failed";
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
