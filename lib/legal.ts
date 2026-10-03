/**
 * The one date the policy pages print, and the one place it is written.
 *
 * `/privacy`, `/terms` and their `/zh` counterparts all show a "last updated"
 * line, and a reviewer reads a mismatch between two of them as a page that was
 * quietly edited. Four hand-kept dates is four chances for that; this is one.
 *
 * It is a literal rather than a build timestamp on purpose: the date has to
 * mean "the day the wording last changed", not "the day this was last
 * deployed". Bump it when the policy text actually changes.
 */
export const POLICY_LAST_UPDATED = "30 September 2026";
/** The same day as an ISO date, for the sitemap. `tests/page-metadata.test.ts` pins the two together. */
export const POLICY_LAST_UPDATED_ISO = "2026-09-30";

/** The same date written for a Chinese reader. */
export const POLICY_LAST_UPDATED_ZH = "2026 年 9 月 30 日";
