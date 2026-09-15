/**
 * Every string the quiz page shows, in both languages the site ships.
 *
 * The friend's phone renders this page, and that phone's language is whichever
 * the owner's group chat is in — a Taiwanese host's friends read Chinese, and
 * the whole page is one fetch away from a blank card, so there is no server
 * render to disagree with. That is the one place the argument against
 * localising the site does not apply, and this table is the size of what it
 * buys: one `Record<ErrorLocale, …>` so a missing translation is a compile
 * error, the same trick `lib/error-messages.ts` and `lib/changelog.ts` use.
 * Errors themselves stay in that file; these are the sentences around them.
 *
 * Placeholders are `{name}`, filled by `fillCopy`. `tests/quiz.test.ts` pins
 * that both languages carry the same set.
 */

import type { ErrorLocale } from "@/lib/error-messages";
import type { QuizVerdict } from "@/lib/quiz";

export interface QuizCopy {
  /** With an owner name. */
  introTitleOwner: string;
  /** Without one: the playlist stands in. */
  introTitlePlaylist: string;
  introBody: string;
  /** The link unfurl in the chat. No hint talk — that is for the page. */
  ogDescription: string;
  /** The card when the quiz cannot be read: gone, malformed, or KV blinked. */
  ogFallbackTitle: string;
  ogFallbackDescription: string;
  /* The card image (app/q/[code]/opengraph-image.tsx) */
  /** The pill naming what this is, beside the wordmark. */
  ogQuizLabel: string;
  /** The rule of the game, in one pill. */
  ogRule: string;
  nameLabel: string;
  namePlaceholder: string;
  startButton: string;
  /** Under Start once this phone has already finished the quiz: replays the stored row. */
  resumeButton: string;
  resumeNote: string;
  progress: string;
  promptOwner: string;
  promptPlaylist: string;
  hintButton: string;
  hintLoading: string;
  hintPlaying: string;
  hintNone: string;
  /** The clip was found but the browser refused to start it; a second tap plays it. */
  hintBlocked: string;
  hintsGone: string;
  /** On a question already answered — after Back, or a reload — the way forward. */
  nextButton: string;
  submitButton: string;
  submitting: string;
  resultScore: string;
  hintsUsedLine: string;
  verdicts: Record<QuizVerdict, string>;
  boardTitleOwner: string;
  boardTitlePlaylist: string;
  boardFull: string;
  /** The taker's own ranking, re-read once per tap — never polled. */
  refreshBoard: string;
  refreshingBoard: string;
  youMarker: string;
  shareButton: string;
  copied: string;
  /** Neither the share sheet nor the clipboard worked; the link follows, to copy by hand. */
  shareFailed: string;
  /** The taker's score, with an owner to name. */
  shareText: string;
  /** The taker's score when the quiz has no owner name. */
  shareTextPlaylist: string;
  /** What the owner sends with the link. */
  ownerShareTextOwner: string;
  ownerShareTextPlaylist: string;
  hintStop: string;
  /**
   * The way out and into making one: under a taker's result (the loop's
   * `quiz_result` surface) and in place of Retry when the quiz is gone, where
   * retrying a 404 cannot help. One phrase for both, like `LOOP_CTA_LABEL` —
   * it is the quiz's own because the link lands on the quiz's own page
   * (`/quiz`) and is read in the taker's language.
   */
  makeYourOwn: string;
  expires: string;
  loading: string;
  retry: string;
  /* The owner's results page */
  boardPageTitle: string;
  boardQuestionCount: string;
  boardTakers: string;
  boardAverage: string;
  boardEmpty: string;
  boardPerQuestion: string;
  boardQuestionLabel: string;
  boardCorrectRate: string;
  boardNoData: string;
  /** Only where the reader is not the owner: the way to the quiz they can take. */
  boardOpenQuiz: string;
  boardCopyLink: string;
  boardShareLink: string;
  boardHintsColumn: string;
  boardRankingTitle: string;
  /** The two songs the whole board turned on. */
  boardEasiest: string;
  boardHardest: string;
  /** Fetches the board again on tap; no polling, the route is tightly limited. */
  boardRefresh: string;
  boardRefreshing: string;
  /** Share sheet and clipboard both refused; the URL is printed under this line, to copy by hand. */
  boardShareFailed: string;
  /* The duel page: what sits around the two answers */
  backButton: string;
  resultKicker: string;
  /** Under the score: whose taste, or which playlist. */
  resultSubjectOwner: string;
  resultSubjectPlaylist: string;
  rankLine: string;
  /** On the seam the moment a question is answered: the verdict for that one. */
  revealRight: string;
  revealWrong: string;
  /** On a question answered whose verdict never arrived, seen again after Back or a reload. */
  revealPending: string;
  /* The host's panel on the setup page, once the link exists */
  panelQuestionsFrom: string;
  panelSend: string;
  panelCopyLink: string;
  panelCopied: string;
  /** Neither the share sheet nor the clipboard worked. The link is printed under this line; say so. */
  panelShareFailed: string;
  panelBoardLink: string;
  /** Two constraints in one line: results are on this device, and the link has an end. */
  panelResultsUntil: string;
  panelShareTitle: string;
  panelQrAlt: string;
}

export const QUIZ_COPY: Record<ErrorLocale, QuizCopy> = {
  en: {
    introTitleOwner: "How well do you know {owner}'s music taste?",
    introTitlePlaylist: "How well do you know this playlist?",
    introBody:
      "{count} questions, two songs each — only one is really in the playlist. You get {hints} {hintWord} to hear the song if you're stuck.",
    ogDescription:
      "{count} questions. Two songs each, only one is really in the playlist. Can you tell which?",
    ogFallbackTitle: "How well do you know your friend's music taste?",
    ogFallbackDescription:
      "Two songs a question, only one is really in the playlist. Can you tell which?",
    ogQuizLabel: "Music taste quiz",
    ogRule: "Two songs a question — only one is in the playlist",
    nameLabel: "Your name",
    namePlaceholder: "So they know who beat them",
    startButton: "Start →",
    resumeButton: "See my result again",
    resumeNote: "This phone already took it as {name}.",
    progress: "Question {n} of {total}",
    promptOwner: "Which of these is in {owner}'s playlist?",
    promptPlaylist: "Which of these is in the playlist?",
    hintButton: "Hear a hint ({remaining} left)",
    hintLoading: "Finding a clip…",
    hintPlaying: "That's the song that's in the playlist",
    hintNone: "No clip for this one — the hint wasn't spent",
    hintBlocked: "The clip couldn't start — tap the hint again",
    hintsGone: "No hints left",
    nextButton: "Next →",
    submitButton: "See my score",
    submitting: "Grading…",
    resultScore: "{correct} / {total}",
    hintsUsedLine: "{hints} {hintWord} used",
    verdicts: {
      soulmate: "Musical soulmate",
      close: "You really know their taste",
      acquaintance: "Getting there",
      guessing: "Coin flip",
      stranger: "Total stranger",
    },
    boardTitleOwner: "Who knows {owner} best",
    boardTitlePlaylist: "Leaderboard",
    boardFull: "The board is full, so your score wasn't saved — it still counts.",
    refreshBoard: "Refresh",
    refreshingBoard: "Refreshing…",
    youMarker: "you",
    shareButton: "Share my score",
    copied: "Copied!",
    shareFailed: "Couldn't share or copy — copy this link by hand:",
    shareText: "I got {correct}/{total} on {owner}'s music taste quiz. Can you beat me?",
    shareTextPlaylist: "I got {correct}/{total} on the \"{playlist}\" playlist quiz. Can you beat me?",
    ownerShareTextOwner: "How well do you know {owner}'s music taste? {count} questions.",
    ownerShareTextPlaylist: "How well do you know the \"{playlist}\" playlist? {count} questions.",
    hintStop: "Stop",
    makeYourOwn: "Make your own quiz →",
    expires: "This quiz expires on {date}.",
    loading: "Loading…",
    retry: "Try again",
    boardPageTitle: "Results",
    boardQuestionCount: "{count} questions",
    boardTakers: "{count} took it",
    boardAverage: "average {avg} / {total}",
    boardEmpty: "Nobody has taken it yet. Send the link and check back.",
    boardPerQuestion: "By question",
    boardQuestionLabel: "Q{n}",
    boardCorrectRate: "{correct} of {answered} got it",
    boardNoData: "no results yet",
    boardOpenQuiz: "Open the quiz",
    boardCopyLink: "Copy link",
    boardShareLink: "Send to friends",
    boardHintsColumn: "hints",
    boardRankingTitle: "Ranking",
    boardEasiest: "Everyone knew",
    boardHardest: "Nobody could place",
    boardRefresh: "Refresh",
    boardRefreshing: "Refreshing…",
    boardShareFailed: "Couldn't open the share sheet or the clipboard — copy this link by hand:",
    backButton: "Back",
    resultKicker: "Your verdict",
    resultSubjectOwner: "on {owner}'s taste",
    resultSubjectPlaylist: "on \"{playlist}\"",
    rankLine: "#{rank} of {count}",
    revealRight: "Right — that's the one",
    revealWrong: "Nope — it's the other one",
    revealPending: "Answered — it counts at the end",
    panelQuestionsFrom: "{count} questions from",
    panelSend: "Send to friends →",
    panelCopyLink: "Copy link",
    panelCopied: "✓ Copied",
    panelShareFailed: "Couldn't share or copy from here — press and hold this link to copy it:",
    panelBoardLink: "See results →",
    panelResultsUntil: "Results show only on this device, until {date}.",
    panelShareTitle: "GuessSong taste quiz",
    panelQrAlt: "QR code for quiz {code}",
  },
  zh: {
    introTitleOwner: "你有多懂 {owner} 的音樂品味？",
    introTitlePlaylist: "你有多懂這份歌單？",
    introBody:
      "共 {count} 題，每題兩首歌，只有一首真的在歌單裡。卡住的話有 {hints} {hintWord}可以聽片段。",
    ogDescription: "共 {count} 題。每題兩首歌，只有一首真的在歌單裡，你分得出來嗎？",
    ogFallbackTitle: "你有多懂朋友的音樂品味？",
    ogFallbackDescription: "每題兩首歌，只有一首真的在歌單裡，你分得出來嗎？",
    ogQuizLabel: "音樂品味測驗",
    ogRule: "每題兩首歌，只有一首在歌單裡",
    nameLabel: "你的名字",
    namePlaceholder: "讓對方知道是誰贏了",
    startButton: "開始 →",
    resumeButton: "再看一次我的結果",
    resumeNote: "這支手機已經用「{name}」作答過了。",
    progress: "第 {n} 題，共 {total} 題",
    promptOwner: "哪一首在 {owner} 的歌單裡？",
    promptPlaylist: "哪一首在歌單裡？",
    hintButton: "聽提示（剩 {remaining} 次）",
    hintLoading: "找片段中…",
    hintPlaying: "這就是歌單裡的那一首",
    hintNone: "這首沒有片段 — 提示沒扣",
    hintBlocked: "片段沒播出來 — 再點一次提示",
    hintsGone: "提示用完了",
    nextButton: "下一題 →",
    submitButton: "看我的分數",
    submitting: "計分中…",
    resultScore: "{correct} / {total}",
    hintsUsedLine: "用了 {hints} {hintWord}",
    verdicts: {
      soulmate: "音樂靈魂伴侶",
      close: "你真的很懂他的品味",
      acquaintance: "有點懂",
      guessing: "用猜的",
      stranger: "完全不熟",
    },
    boardTitleOwner: "誰最懂 {owner}",
    boardTitlePlaylist: "排行榜",
    boardFull: "排行榜已經滿了，分數沒有存下來 — 但還是算數。",
    refreshBoard: "更新",
    refreshingBoard: "更新中…",
    youMarker: "你",
    shareButton: "分享我的分數",
    copied: "已複製！",
    shareFailed: "沒辦法分享或複製 — 請手動複製這個連結：",
    shareText: "我在 {owner} 的音樂品味測驗拿了 {correct}/{total}，你能贏我嗎？",
    shareTextPlaylist: "我在「{playlist}」這份歌單的測驗拿了 {correct}/{total}，你能贏我嗎？",
    ownerShareTextOwner: "你有多懂 {owner} 的音樂品味？共 {count} 題。",
    ownerShareTextPlaylist: "你有多懂「{playlist}」這份歌單？共 {count} 題。",
    hintStop: "停止",
    makeYourOwn: "自己做一份品味鑒定 →",
    expires: "這個測驗會在 {date} 到期。",
    loading: "載入中…",
    retry: "再試一次",
    boardPageTitle: "結果",
    boardQuestionCount: "共 {count} 題",
    boardTakers: "{count} 人作答",
    boardAverage: "平均 {avg} / {total}",
    boardEmpty: "還沒有人作答。把連結傳出去，晚點再回來看。",
    boardPerQuestion: "各題答對率",
    boardQuestionLabel: "第 {n} 題",
    boardCorrectRate: "{answered} 人裡有 {correct} 人答對",
    boardNoData: "還沒有資料",
    boardOpenQuiz: "打開測驗",
    boardCopyLink: "複製連結",
    boardShareLink: "傳給朋友",
    boardHintsColumn: "提示",
    boardRankingTitle: "排行榜",
    boardEasiest: "最多人答對",
    boardHardest: "最少人答對",
    boardRefresh: "重新整理",
    boardRefreshing: "更新中…",
    boardShareFailed: "打不開分享面板，也寫不進剪貼簿 — 請手動複製這個連結：",
    backButton: "上一題",
    resultKicker: "你的判決",
    resultSubjectOwner: "對 {owner} 的品味",
    resultSubjectPlaylist: "對「{playlist}」",
    rankLine: "第 {rank} 名，共 {count} 人",
    revealRight: "答對了，就是這首",
    revealWrong: "答錯了，是另一首",
    revealPending: "已作答，最後一起計分",
    panelQuestionsFrom: "共 {count} 題，來自",
    panelSend: "傳給朋友 →",
    panelCopyLink: "複製連結",
    panelCopied: "✓ 已複製",
    panelShareFailed: "這裡沒辦法分享或複製 — 長按這個連結來複製：",
    panelBoardLink: "看結果 →",
    panelResultsUntil: "結果只有這台裝置看得到，連結會在 {date} 失效。",
    panelShareTitle: "品味鑒定",
    panelQrAlt: "測驗 {code} 的行動條碼",
  },
};

/** Fills `{name}` placeholders. Unknown ones are left as-is, like `errorMessage`. */
export function fillCopy(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = params[key];
    return value === undefined ? whole : String(value);
  });
}

/** What the card image says. Every string comes from the table above. */
export interface QuizCardCopy {
  /** The pill beside the wordmark: what this is. */
  label: string;
  title: string;
  /**
   * The line under the title, the one other fact the card is for: the
   * question count — and, when no owner was given, the playlist's name in
   * front of it, since the title then asks about "this playlist". Null when
   * the quiz could not be read. A chat thumbnail keeps this size; it does
   * not keep a pill's.
   */
  subtitle: string | null;
  /** The rule, as furniture. */
  pills: string[];
}

/**
 * The words on the quiz link's card image (app/q/[code]/opengraph-image.tsx),
 * in the owner's language — the friend it reaches is in the owner's chat.
 * `null` is the card for a quiz that could not be read: gone, malformed, or
 * a KV blink; it stays quiz-shaped and says nothing about a party. Kept out
 * of the image file because the suite cannot import a `.tsx` module here.
 */
export function quizCardCopy(
  peek: { locale: ErrorLocale; ownerName: string | null; playlistName: string; questionCount: number } | null
): QuizCardCopy {
  const copy = QUIZ_COPY[peek?.locale ?? "en"];
  if (!peek) {
    return { label: copy.ogQuizLabel, title: copy.ogFallbackTitle, subtitle: null, pills: [copy.ogRule] };
  }
  const count = fillCopy(copy.boardQuestionCount, { count: peek.questionCount });
  return {
    label: copy.ogQuizLabel,
    title: quizTitle(copy, peek.ownerName),
    subtitle: peek.ownerName ? count : `${peek.playlistName} · ${count}`,
    pills: [copy.ogRule],
  };
}

/** The card title: whose taste, or which playlist when no owner was named. */
export function quizTitle(copy: QuizCopy, ownerName: string | null | undefined): string {
  return ownerName ? fillCopy(copy.introTitleOwner, { owner: ownerName }) : copy.introTitlePlaylist;
}

/** The sentence a host sends with the link, in the host's own language. */
export function ownerShareText(
  copy: QuizCopy,
  quiz: { ownerName: string | null; playlistName: string; questionCount: number }
): string {
  return quiz.ownerName
    ? fillCopy(copy.ownerShareTextOwner, { owner: quiz.ownerName, count: quiz.questionCount })
    : fillCopy(copy.ownerShareTextPlaylist, { playlist: quiz.playlistName, count: quiz.questionCount });
}

/** The sentence a taker sends with their score. */
export function takerShareText(
  copy: QuizCopy,
  quiz: { ownerName: string | null; playlistName: string },
  score: { correct: number; total: number }
): string {
  return quiz.ownerName
    ? fillCopy(copy.shareText, { ...score, owner: quiz.ownerName })
    : fillCopy(copy.shareTextPlaylist, { ...score, playlist: quiz.playlistName });
}

/** The expiry as a date in the reader's language. Client only — a locale string. */
export function formatQuizDate(ms: number, locale: ErrorLocale): string {
  return new Date(ms).toLocaleDateString(locale === "zh" ? "zh-TW" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** "hint" / "hints", or the Chinese measure word, which has no plural to get wrong. */
export function hintWord(locale: ErrorLocale, count: number): string {
  if (locale === "zh") return "次提示";
  return count === 1 ? "hint" : "hints";
}
