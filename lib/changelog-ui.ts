/**
 * The overlay's chrome — its trigger label, title, close label — apart from
 * the release notes themselves.
 *
 * Split out of `lib/changelog.ts` for the bundle, not for tidiness: the footer
 * button on every page needs the trigger string, and importing it from the
 * module that also holds every release note dragged ~20 kB (gzipped) of
 * bilingual prose into each page's first load, for an overlay almost nobody
 * opens. The notes now arrive with `components/changelog-dialog.tsx`, on the
 * first tap. `lib/changelog.ts` re-exports both names, so every existing
 * import keeps working.
 */

export type ChangelogLocale = "en" | "zh";

/** How a line reads on the page. Purely presentational grouping. */
export type ChangeKind = "new" | "better" | "fixed";

/** Every string the overlay renders that isn't release content. */
export const CHANGELOG_UI: Record<
  ChangelogLocale,
  {
    trigger: string;
    title: string;
    currentVersion: string;
    close: string;
    kinds: Record<ChangeKind, string>;
    footnotePrefix: string;
    footnoteSuffix: string;
  }
> = {
  en: {
    trigger: "What's new",
    title: "What's new",
    currentVersion: "Currently on v",
    close: "Close what's new",
    kinds: { new: "New", better: "Better", fixed: "Fixed" },
    footnotePrefix: "Older releases and the full technical history live in ",
    footnoteSuffix: " in the repo.",
  },
  zh: {
    trigger: "更新內容",
    title: "更新內容",
    currentVersion: "目前版本 v",
    close: "關閉更新內容",
    kinds: { new: "新增", better: "改善", fixed: "修正" },
    footnotePrefix: "更早的版本和完整的技術紀錄都在原始碼的 ",
    footnoteSuffix: " 裡。",
  },
};

