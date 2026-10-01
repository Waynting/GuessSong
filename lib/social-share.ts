/**
 * Post-to-a-platform links, for a browser that has no share sheet.
 *
 * Of 21 owner taps on the quiz panel's share button, 3 opened a share sheet:
 * most quizzes are made on a laptop, where `navigator.share` does not exist
 * and the button falls back to the clipboard. These links are the laptop's
 * share sheet — a web intent per platform the site's audience posts to — and
 * are rendered only where the real sheet is missing. A phone already has
 * every one of these apps in its sheet, and a second row of them there is
 * noise beside the button that works.
 *
 * Pure, and in `lib/`, so the suite can reach it: the URL each platform takes
 * is a fact about that platform, easy to get subtly wrong (a `text` LINE
 * ignores, a `url` Threads does not read) and invisible until someone posts.
 *
 * `SOCIAL_PLATFORMS` is also a closed set of KV key tails
 * (`quiz_social:<by>:<platform>`, `recordQuizSocial` in `lib/loop-stats.ts`),
 * which is why it is a const tuple and not a record's keys.
 */

import type { ErrorLocale } from "@/lib/error-messages";

export const SOCIAL_PLATFORMS = ["line", "threads", "x", "facebook", "whatsapp"] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return typeof value === "string" && (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

/** The button's label: the platform's own name, the same in every language. */
export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  line: "LINE",
  threads: "Threads",
  x: "X",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
};

/**
 * The row's order for a reader. LINE leads for a Chinese reader — it is where
 * a Taiwanese group chat is — and X for an English one. Every platform is in
 * both, so the order never decides what can be reached, only what is first.
 */
export function socialPlatformsFor(locale: ErrorLocale): readonly SocialPlatform[] {
  return locale === "zh"
    ? ["line", "threads", "facebook", "x", "whatsapp"]
    : ["x", "whatsapp", "facebook", "threads", "line"];
}

/** `text` then `url`, for the platforms whose intent has one field for both. */
function joined(url: string, text: string | undefined): string {
  return text ? `${text} ${url}` : url;
}

/**
 * The intent URL that opens `platform`'s composer with the link in it.
 *
 * Every value goes through `encodeURIComponent`: the text is a quiz title
 * with an owner's name in it, which is user input. LINE and Facebook take the
 * address alone and read the rest from the page's card; Threads and WhatsApp
 * take one text field, so the sentence and the address go in it together; X
 * takes both apart and joins them itself.
 */
export function socialShareUrl(
  platform: SocialPlatform,
  { url, text }: { url: string; text?: string }
): string {
  const e = encodeURIComponent;
  switch (platform) {
    case "line":
      return `https://social-plugins.line.me/lineit/share?url=${e(url)}`;
    case "threads":
      return `https://www.threads.net/intent/post?text=${e(joined(url, text))}`;
    case "x":
      return text
        ? `https://x.com/intent/post?text=${e(text)}&url=${e(url)}`
        : `https://x.com/intent/post?url=${e(url)}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${e(url)}`;
    case "whatsapp":
      return `https://wa.me/?text=${e(joined(url, text))}`;
  }
}
