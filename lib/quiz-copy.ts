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
  nameLabel: string;
  namePlaceholder: string;
  startButton: string;
  progress: string;
  promptOwner: string;
  promptPlaylist: string;
  hintButton: string;
  hintLoading: string;
  hintPlaying: string;
  hintNone: string;
  hintsGone: string;
  nextButton: string;
  submitButton: string;
  submitting: string;
  resultScore: string;
  hintsUsedLine: string;
  verdicts: Record<QuizVerdict, string>;
  reviewTitle: string;
  boardTitleOwner: string;
  boardTitlePlaylist: string;
  boardFull: string;
  youMarker: string;
  shareButton: string;
  copied: string;
  /** The taker's score, with an owner to name. */
  shareText: string;
  /** The taker's score when the quiz has no owner name. */
  shareTextPlaylist: string;
  /** What the owner sends with the link. */
  ownerShareTextOwner: string;
  ownerShareTextPlaylist: string;
  hintStop: string;
  ctaButton: string;
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
  boardOpenQuiz: string;
  boardCopyLink: string;
  boardShareLink: string;
  boardHintsColumn: string;
  boardRankingTitle: string;
  /** The two songs the whole board turned on. */
  boardEasiest: string;
  boardHardest: string;
  /* The duel page: what sits around the two answers */
  backButton: string;
  resultKicker: string;
  /** Under the score: whose taste, or which playlist. */
  resultSubjectOwner: string;
  resultSubjectPlaylist: string;
  rankLine: string;
  reviewRight: string;
  reviewMissed: string;
  /* The host's panel on the setup page, once the link exists */
  panelQuestionsFrom: string;
  panelSend: string;
  panelCopyLink: string;
  panelCopied: string;
  /** Neither the share sheet nor the clipboard worked. The link is on screen as text; say so. */
  panelShareFailed: string;
  panelBoardLink: string;
  panelDeviceOnly: string;
  panelExpires: string;
  panelShareTitle: string;
  panelQrAlt: string;
}

export const QUIZ_COPY: Record<ErrorLocale, QuizCopy> = {
  en: {
    introTitleOwner: "How well do you know {owner}'s music taste?",
    introTitlePlaylist: "How well do you know this playlist?",
    introBody:
      "{count} questions. Each is two songs and only one is really in the playlist — guess first. You get {hints} {hintWord} to hear the song if you're stuck.",
    ogDescription:
      "{count} questions. Two songs each, only one is really in the playlist. Can you tell which?",
    nameLabel: "Your name",
    namePlaceholder: "So they know who beat them",
    startButton: "Start →",
    progress: "Question {n} of {total}",
    promptOwner: "Which of these is in {owner}'s playlist?",
    promptPlaylist: "Which of these is in the playlist?",
    hintButton: "Hear a hint ({remaining} left)",
    hintLoading: "Finding a clip…",
    hintPlaying: "That's the song that's in the playlist",
    hintNone: "No clip for this one — the hint wasn't spent",
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
      stranger: "Total stranger",
    },
    reviewTitle: "The answers",
    boardTitleOwner: "Who knows {owner} best",
    boardTitlePlaylist: "Leaderboard",
    boardFull: "The board is full, so your score wasn't saved — it still counts.",
    youMarker: "you",
    shareButton: "Share my score",
    copied: "Copied!",
    shareText: "I got {correct}/{total} on {owner}'s music taste quiz. Can you beat me?",
    shareTextPlaylist: "I got {correct}/{total} on the \"{playlist}\" playlist quiz. Can you beat me?",
    ownerShareTextOwner: "How well do you know {owner}'s music taste? {count} questions.",
    ownerShareTextPlaylist: "How well do you know the \"{playlist}\" playlist? {count} questions.",
    hintStop: "Stop",
    ctaButton: "Make one for your friends →",
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
    backButton: "Back",
    resultKicker: "Your verdict",
    resultSubjectOwner: "on {owner}'s taste",
    resultSubjectPlaylist: "on \"{playlist}\"",
    rankLine: "#{rank} of {count}",
    reviewRight: "Right",
    reviewMissed: "Missed",
    panelQuestionsFrom: "{count} questions from",
    panelSend: "Send to friends →",
    panelCopyLink: "Copy link",
    panelCopied: "✓ Copied",
    panelShareFailed: "Couldn't share or copy from here — press and hold the link above to copy it.",
    panelBoardLink: "See results — who knows you best →",
    panelDeviceOnly: "Results are only visible on this device.",
    panelExpires: "The link stops working on {date}.",
    panelShareTitle: "GuessSong taste quiz",
    panelQrAlt: "QR code for quiz {code}",
  },
  zh: {
    introTitleOwner: "你有多懂 {owner} 的音樂品味？",
    introTitlePlaylist: "你有多懂這份歌單？",
    introBody:
      "共 {count} 題。每題兩首歌，只有一首真的在歌單裡 — 先用猜的。卡住的話有 {hints} {hintWord}可以聽片段。",
    ogDescription: "共 {count} 題。每題兩首歌，只有一首真的在歌單裡，你分得出來嗎？",
    nameLabel: "你的名字",
    namePlaceholder: "讓對方知道是誰贏了",
    startButton: "開始 →",
    progress: "第 {n} 題，共 {total} 題",
    promptOwner: "哪一首在 {owner} 的歌單裡？",
    promptPlaylist: "哪一首在歌單裡？",
    hintButton: "聽提示（剩 {remaining} 次）",
    hintLoading: "找片段中…",
    hintPlaying: "這就是歌單裡的那一首",
    hintNone: "這首沒有片段 — 提示沒扣",
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
      stranger: "完全不熟",
    },
    reviewTitle: "解答",
    boardTitleOwner: "誰最懂 {owner}",
    boardTitlePlaylist: "排行榜",
    boardFull: "排行榜已經滿了，分數沒有存下來 — 但還是算數。",
    youMarker: "你",
    shareButton: "分享我的分數",
    copied: "已複製！",
    shareText: "我在 {owner} 的音樂品味測驗拿了 {correct}/{total}，你能贏我嗎？",
    shareTextPlaylist: "我在「{playlist}」這份歌單的測驗拿了 {correct}/{total}，你能贏我嗎？",
    ownerShareTextOwner: "你有多懂 {owner} 的音樂品味？共 {count} 題。",
    ownerShareTextPlaylist: "你有多懂「{playlist}」這份歌單？共 {count} 題。",
    hintStop: "停止",
    ctaButton: "幫你的朋友也做一個 →",
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
    backButton: "上一題",
    resultKicker: "你的判決",
    resultSubjectOwner: "對 {owner} 的品味",
    resultSubjectPlaylist: "對「{playlist}」",
    rankLine: "第 {rank} 名，共 {count} 人",
    reviewRight: "答對",
    reviewMissed: "答錯",
    panelQuestionsFrom: "共 {count} 題，來自",
    panelSend: "傳給朋友 →",
    panelCopyLink: "複製連結",
    panelCopied: "✓ 已複製",
    panelShareFailed: "這裡沒辦法分享或複製 — 長按上面的連結來複製。",
    panelBoardLink: "看結果：誰最懂你 →",
    panelDeviceOnly: "結果只有這台裝置看得到。",
    panelExpires: "連結會在 {date} 失效。",
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
