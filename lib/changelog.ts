/**
 * Player-facing release notes for the footer's "What's new" overlay.
 *
 * Deliberately *not* generated from CHANGELOG.md. That file is written for
 * whoever maintains this code — it talks about Durable Objects, KV round-trips
 * and function names, and its "Known gaps" sections are a maintainer's todo
 * list. This list is for someone who came here to play a party game and wants
 * to know what changed since last time. Both are hand-written, and a release
 * updates both.
 *
 * ## Why every line is bilingual
 *
 * `/zh` exists because the Chinese landing page is written natively rather than
 * translated (see CHANGELOG 0.4.0), and its footer says 回報問題, not "Report a
 * problem". An English-only overlay opening off that footer would undo the one
 * thing that page is for. So each entry carries both languages side by side,
 * as parallel fields rather than two separate lists — a missing translation is
 * then a type error at the callsite instead of a silent English fallback, and
 * a test asserts neither side is empty.
 *
 * Newest first. The overlay trusts that order: it reports `entries[0].version`
 * as the version a reader saw, so a release added out of order would attribute
 * its reads to the wrong version.
 */

export type ChangelogLocale = "en" | "zh";

/** How a line reads on the page. Purely presentational grouping. */
export type ChangeKind = "new" | "better" | "fixed";

export interface ChangelogChange {
  kind: ChangeKind;
  /** Plain text — the overlay does not render markdown. */
  text: string;
  /** Traditional Chinese. Written for a Chinese reader, not translated word for word. */
  textZh: string;
}

export interface ChangelogEntry {
  version: string;
  /** ISO date. Formatted by `formatChangelogDate`, never `toLocaleDateString` —
   *  see the note on that function. */
  date: string;
  /** One line on what this release was about. */
  headline: string;
  headlineZh: string;
  changes: ChangelogChange[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.0.0",
    date: "2026-07-30",
    headline:
      "GuessSong 1.0. The party game, Buzzer Mode, Mixed Playlist Mode and the Chinese site are all finished — this release names that rather than adding to it.",
    headlineZh:
      "GuessSong 1.0 正式版。派對遊戲、搶答模式、混合歌單模式、中文版都完成了，這一版是為它們正式定名，而不是又加了什麼。",
    changes: [
      {
        kind: "new",
        text: "This panel. Every release from now on gets a plain-language note here, in English and Chinese, from the footer of any page.",
        textZh:
          "你正在看的這個視窗。從這一版開始，每次更新都會在這裡留下一段人話說明，中英文都有，任何頁面的頁尾都打得開。",
      },
      {
        kind: "better",
        text: "The QR code flow is now measured end to end. A code people scan but fail to get through shows up as something to fix, instead of quietly looking like nobody scanned it.",
        textZh:
          "掃 QR code 加入房間的每一步現在都量得到了。以前有人掃了卻卡在表單上，數字看起來跟沒人掃一模一樣；現在卡住會被看見，才修得到。",
      },
    ],
  },
  {
    version: "0.4.0",
    date: "2026-07-29",
    headline: "Easier to find, and now readable in Chinese.",
    headlineZh: "更好找，而且看得懂中文了。",
    changes: [
      {
        kind: "new",
        text: "A Traditional Chinese version of the site at /zh — written natively rather than machine-translated.",
        textZh: "/zh 的繁體中文版本，是直接用中文寫的，不是機器翻譯過來的。",
      },
      {
        kind: "better",
        text: "The homepage now explains how the game actually works, and answers the six questions people ask most, instead of being a form and one paragraph.",
        textZh:
          "首頁現在會好好說明遊戲怎麼玩，也回答了大家最常問的六個問題，不再只是一個輸入框加一段話。",
      },
    ],
  },
  {
    version: "0.3.0",
    date: "2026-07-29",
    headline: "Everyone gets a buzzer.",
    headlineZh: "每個人都有一顆搶答鈕。",
    changes: [
      {
        kind: "new",
        text: "Buzzer Mode — every player buzzes in from their own phone, so the host can stop refereeing “who said it first” and actually play. The host buzzes with the space bar.",
        textZh:
          "搶答模式：每個人用自己的手機搶答，主持人不用再當裁判判「誰先講的」，可以真的一起玩。主持人按空白鍵搶答。",
      },
      {
        kind: "new",
        text: "One QR code for everything. Buzzer Mode and Mixed Playlist Mode used to hand out two different codes on two different pages; players now scan once and get both.",
        textZh:
          "一個 QR code 就搞定。以前搶答模式和混合歌單模式會給兩組不同的房間代碼、兩個不同的頁面，現在掃一次兩個都有。",
      },
      {
        kind: "new",
        text: "The host can add their own playlist in Mixed Playlist Mode. They are holding the screen everyone else is scanning, so they could never scan it themselves.",
        textZh:
          "主持人在混合歌單模式裡也能加自己的歌單了。他們拿的正是大家要掃的那塊螢幕，本來根本掃不到自己。",
      },
      {
        kind: "better",
        text: "Buzzing in pauses the clip so the room can hear the answer, and Resume, Stop and Replay stay available until you reveal it.",
        textZh:
          "有人搶答時音樂會自動暫停，大家才聽得到答案；在公布答案之前，繼續播、停止、重播都還按得到。",
      },
      {
        kind: "better",
        text: "A wrong answer passes the question down to whoever buzzed next, instead of ending the round.",
        textZh: "答錯不會直接結束這一題，而是把機會往下傳給下一個搶到的人。",
      },
      {
        kind: "better",
        text: "The room code now appears after the settings, not before them — it is the last step, when it is genuinely time to gather people.",
        textZh:
          "房間代碼現在排在所有設定之後才出現。它是最後一步，等真的要把人叫過來的時候才需要。",
      },
      {
        kind: "fixed",
        text: "Correct and Wrong did nothing at all once the answer had been revealed.",
        textZh: "公布答案之後，「答對」和「答錯」按了完全沒反應。",
      },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-07-12",
    headline: "Play with everyone's music, not just the host's.",
    headlineZh: "放大家的歌，不只是主持人的歌。",
    changes: [
      {
        kind: "new",
        text: "Mixed Playlist Mode — everyone adds their own playlist, GuessSong merges them into one round and drops the duplicates. Pass the host's phone around, or let people scan a QR code from their own.",
        textZh:
          "混合歌單模式：每個人加自己的歌單，GuessSong 會合成一份並去掉重複的歌。可以把主持人的手機傳一輪，也可以讓大家用自己的手機掃 QR code。",
      },
      {
        kind: "new",
        text: "A bonus point for guessing whose playlist a track came from.",
        textZh: "猜中這首歌是誰的歌單裡的，可以多拿分。",
      },
      {
        kind: "new",
        text: "A shareable Taste Card at the end of a mixed game: the tracks you all had, most obscure taste, and most mainstream.",
        textZh:
          "混合歌單玩完會產生一張可以分享的音樂品味卡：大家都有的歌、品味最冷門的人、最主流的人。",
      },
      {
        kind: "fixed",
        text: "Two players submitting a playlist at the same moment could quietly overwrite each other.",
        textZh: "兩個人同時送出歌單時，其中一份會被默默蓋掉。",
      },
    ],
  },
];

/** The newest release. Used as the `version` on the `changelog_opened` event. */
export const LATEST_VERSION = CHANGELOG[0].version;

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

/** Pick a change's text for a locale. Keeps the ternary out of the JSX. */
export function changeText(change: ChangelogChange, locale: ChangelogLocale): string {
  return locale === "zh" ? change.textZh : change.text;
}

export function entryHeadline(entry: ChangelogEntry, locale: ChangelogLocale): string {
  return locale === "zh" ? entry.headlineZh : entry.headline;
}

/**
 * Format an ISO date without going through `toLocaleDateString`.
 *
 * The locale-aware formatters resolve against the *runtime's* locale and time
 * zone, which differ between the Node process that prerenders these pages and
 * the browser that hydrates them — React reports that as a hydration mismatch.
 * A fixed table has no such gap.
 */
export function formatChangelogDate(iso: string, locale: ChangelogLocale = "en"): string {
  const [year, month, day] = iso.split("-");
  if (locale === "zh") {
    return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
  }
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${Number(day)} ${months[Number(month) - 1]} ${year}`;
}
