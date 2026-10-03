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
  /** The taker's explicit Copy button, beside Share: the same sentence and link, to the clipboard. */
  copyLinkButton: string;
  copied: string;
  /**
   * Over the post-to-a-platform links, drawn only where there is no share
   * sheet (`components/quiz-social-links.tsx`). The labels under it are the
   * platforms' own names, the same in both languages.
   */
  socialLead: string;
  /** Neither the share sheet nor the clipboard worked; the link follows, to copy by hand. */
  shareFailed: string;
  /** The taker's score, with an owner to name. */
  shareText: string;
  /** The taker's score when the quiz has no owner name. */
  shareTextPlaylist: string;
  /** What the owner sends with the link. */
  ownerShareTextOwner: string;
  ownerShareTextPlaylist: string;
  /**
   * The same, for a quiz whose length this device did not keep and whose
   * owner gave no name. With a name, the title (`introTitleOwner`) is already
   * that sentence without its count.
   */
  ownerShareTextPlaylistBare: string;
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
  /* The owner running their own quiz: the server recognised this device's token */
  /** The word over the intro, where a friend reads the site's name. */
  previewKicker: string;
  /** Two facts, because both are what an owner would otherwise worry about: not saved, not shown. */
  previewIntro: string;
  previewStart: string;
  /** Under the verdict card, in place of `boardFull`: not written for a different reason. */
  previewResultNote: string;
  /* The quiz form on /quiz, before the link exists */
  createTitle: string;
  createSubtitle: string;
  createPlaylistLabel: string;
  createEditorialWarning: string;
  createNameLabel: string;
  createNamePlaceholder: string;
  /** Under the name box. `{title}` is the quiz's own title, filled from `introTitleOwner`. */
  createTitlePreview: string;
  createQuestionsLabel: string;
  /** The typed field's accessible name. */
  createCustomCountLabel: string;
  /** Under the length picker: who answers, and which lengths get finished. */
  createLengthNote: string;
  /** Over the panel when it is a quiz from an earlier visit, not one just made. */
  createLastQuiz: string;
  createLoading: string;
  createButton: string;
  /** Once a panel is up: pressing it makes a second code, it does not change the first. */
  createAgainButton: string;
  createBackToParty: string;
  /** Where the panel will be, while its chunk is on the way. */
  createMakingLink: string;
  /** The panel's chunk never arrived; the link as text follows this. */
  createLinkFallback: string;
  /* The host's panel on the setup page, once the link exists */
  panelQuestionsFrom: string;
  /** The caption without a count, for a quiz this device remembers from before it kept one. */
  panelQuizFrom: string;
  panelSend: string;
  panelCopyLink: string;
  panelCopied: string;
  /** Neither the share sheet nor the clipboard worked. The link is printed under this line; say so. */
  panelShareFailed: string;
  panelBoardLink: string;
  /** To `/q/<CODE>`, where this device's token makes the run a preview. */
  panelPreviewLink: string;
  /** Two constraints in one line: results are on this device, and the link has an end. */
  panelResultsUntil: string;
  panelShareTitle: string;
  panelQrAlt: string;
  /* The owner's dashboard on /q/mine: every quiz this device made */
  mineTitle: string;
  mineSubtitle: string;
  /** On /quiz, under the form, when this device holds at least one token. `{count}` quizzes. */
  mineLink: string;
  /** No token on this device: the dashboard has nothing to ask about. */
  mineEmpty: string;
  mineCreate: string;
  /** Badge on a card whose taker count grew since the last visit. */
  mineNew: string;
  /** Beside the big taker count on a card. */
  mineTakersLabel: string;
  mineLeader: string;
  /** "Last answer 3h ago": `{when}` is a relative time from `relativeTime`. */
  mineLatest: string;
  /** Days left before the link stops working. */
  mineExpiresIn: string;
  /** Less than 24 hours left — not "today", which a late-evening quiz is not. */
  mineExpiresToday: string;
  mineResults: string;
  mineOpen: string;
  /** The quiz expired: still listed so the owner is told, not left wondering where it went. */
  mineGone: string;
  /** A token the server does not recognise — storage edited or a quiz recreated. */
  mineNotHost: string;
  /** Totals over every live quiz, at the top of the page. */
  mineTotalQuizzes: string;
  mineTotalTakers: string;
  /** Under the list: why it is this device only, and what keeps it. */
  mineDeviceNote: string;
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
    copyLinkButton: "Copy link",
    copied: "Copied!",
    socialLead: "Or post it to",
    shareFailed: "Couldn't share or copy — copy this link by hand:",
    shareText: "I got {correct}/{total} on {owner}'s music taste quiz. Can you beat me?",
    shareTextPlaylist: "I got {correct}/{total} on the \"{playlist}\" playlist quiz. Can you beat me?",
    ownerShareTextOwner: "How well do you know {owner}'s music taste? {count} questions.",
    ownerShareTextPlaylist: "How well do you know the \"{playlist}\" playlist? {count} questions.",
    ownerShareTextPlaylistBare: "How well do you know the \"{playlist}\" playlist?",
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
    previewKicker: "Preview",
    previewIntro:
      "This is your own quiz, as your friends will see it. Your answers aren't saved and won't show on the leaderboard.",
    previewStart: "Start the preview →",
    previewResultNote: "Preview only — this score wasn't saved, and your friends won't see it.",
    createTitle: "Taste Quiz",
    createSubtitle:
      "A link your friends open to guess your taste — and find out who knows you best.",
    createPlaylistLabel: "Spotify Playlist",
    createEditorialWarning: "Editorial playlists (Discover Weekly, etc.) may not work",
    createNameLabel: "Your Name",
    createNamePlaceholder: "Whose taste is this? (optional)",
    createTitlePreview: "Goes in the title: “{title}”",
    createQuestionsLabel: "Questions",
    createCustomCountLabel: "Custom number of questions, {min} to {max}",
    createLengthNote: "Your friends answer these. Short quizzes are the ones that get finished.",
    createLastQuiz: "Your last quiz is still open",
    createLoading: "Loading playlist",
    createButton: "Create quiz link →",
    createAgainButton: "Create a new link →",
    createBackToParty: "← Back to the party game",
    createMakingLink: "Getting your link ready…",
    createLinkFallback: "Your quiz link:",
    panelQuestionsFrom: "{count} questions from",
    panelQuizFrom: "Your quiz from",
    panelSend: "Send to friends →",
    panelCopyLink: "Copy link",
    panelCopied: "✓ Copied",
    panelShareFailed: "Couldn't share or copy from here — press and hold this link to copy it:",
    panelBoardLink: "See results →",
    panelPreviewLink: "Preview your quiz →",
    panelResultsUntil: "Results show only on this device, until {date}.",
    panelShareTitle: "GuessSong taste quiz",
    panelQrAlt: "QR code for quiz {code}",
    mineTitle: "My quizzes",
    mineSubtitle: "Every quiz made on this device, with who has taken it so far. No account — this browser is the key.",
    mineLink: "My quizzes ({count}) →",
    mineEmpty: "This device hasn't made a quiz yet — or its storage was cleared. Quizzes show up here the moment you create one.",
    mineCreate: "Make a quiz",
    mineNew: "+{count} new",
    mineTakersLabel: "took it",
    mineLeader: "Top: {name} {correct}/{total}",
    mineLatest: "Last answer {when}",
    mineExpiresIn: "{days}d left",
    mineExpiresToday: "Under a day left",
    mineResults: "Results",
    mineOpen: "Open",
    mineGone: "Expired — quizzes last a week.",
    mineNotHost: "This device can no longer open its results.",
    mineTotalQuizzes: "live quizzes",
    mineTotalTakers: "friends answered",
    mineDeviceNote: "Only this browser can see this page — results are tied to the device that made the quiz, not to an account. Clearing site data removes it.",
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
    copyLinkButton: "複製連結",
    copied: "已複製！",
    socialLead: "或直接分享到",
    shareFailed: "沒辦法分享或複製 — 請手動複製這個連結：",
    shareText: "我在 {owner} 的音樂品味測驗拿了 {correct}/{total}，你能贏我嗎？",
    shareTextPlaylist: "我在「{playlist}」這份歌單的測驗拿了 {correct}/{total}，你能贏我嗎？",
    ownerShareTextOwner: "你有多懂 {owner} 的音樂品味？共 {count} 題。",
    ownerShareTextPlaylist: "你有多懂「{playlist}」這份歌單？共 {count} 題。",
    ownerShareTextPlaylistBare: "你有多懂「{playlist}」這份歌單？",
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
    previewKicker: "預覽",
    previewIntro: "這是你自己做的測驗，朋友看到的就是這個樣子。你的作答不會存下來，也不會出現在排行榜上。",
    previewStart: "開始預覽 →",
    previewResultNote: "這只是預覽，分數沒有存下來，朋友也看不到。",
    createTitle: "品味鑒定",
    createSubtitle: "做一個連結傳給朋友，讓他們猜你的歌單，看看誰最懂你。",
    createPlaylistLabel: "歌單連結",
    createEditorialWarning: "官方編輯的歌單（像是每週新發現）可能沒辦法用",
    createNameLabel: "你的名字",
    createNamePlaceholder: "這是誰的品味？（可以不填）",
    createTitlePreview: "會出現在標題裡：「{title}」",
    createQuestionsLabel: "題數",
    createCustomCountLabel: "自訂題數，{min} 到 {max} 題",
    createLengthNote: "這些題目是給朋友答的，題數少的比較多人做完。",
    createLastQuiz: "你上次做的測驗還能用",
    createLoading: "讀取歌單中",
    createButton: "產生測驗連結 →",
    createAgainButton: "再做一個新連結 →",
    createBackToParty: "← 回到派對遊戲",
    createMakingLink: "連結準備中…",
    createLinkFallback: "你的測驗連結：",
    panelQuestionsFrom: "共 {count} 題，來自",
    panelQuizFrom: "你的測驗，來自",
    panelSend: "傳給朋友 →",
    panelCopyLink: "複製連結",
    panelCopied: "✓ 已複製",
    panelShareFailed: "這裡沒辦法分享或複製 — 長按這個連結來複製：",
    panelBoardLink: "看結果 →",
    panelPreviewLink: "自己先玩一次 →",
    panelResultsUntil: "結果只有這台裝置看得到，連結會在 {date} 失效。",
    panelShareTitle: "品味鑒定",
    panelQrAlt: "測驗 {code} 的行動條碼",
    mineTitle: "我的測驗",
    mineSubtitle: "這台裝置做過的每一份測驗，和目前有誰作答。不用登入，這個瀏覽器就是鑰匙。",
    mineLink: "我的測驗（{count}）→",
    mineEmpty: "這台裝置還沒做過測驗，或是儲存資料被清掉了。做好一份，它就會出現在這裡。",
    mineCreate: "做一份測驗",
    mineNew: "新增 {count} 人",
    mineTakersLabel: "人作答",
    mineLeader: "第一名：{name} {correct}/{total}",
    mineLatest: "最近作答：{when}",
    mineExpiresIn: "剩 {days} 天",
    mineExpiresToday: "剩不到一天",
    mineResults: "看結果",
    mineOpen: "打開",
    mineGone: "已到期，測驗只保留一週。",
    mineNotHost: "這台裝置已經無法打開它的結果。",
    mineTotalQuizzes: "份進行中",
    mineTotalTakers: "位朋友作答",
    mineDeviceNote: "只有這個瀏覽器看得到這一頁：結果綁在做測驗的那台裝置上，而不是帳號。清除網站資料就會不見。",
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

/**
 * The sentence a host sends with the link, in the host's own language.
 *
 * `questionCount` is null for a quiz this device remembers from before it
 * kept the count (`LastQuiz` in lib/quiz-session.ts). The sentence then drops
 * its second half rather than fill it: "{count} questions" with nothing to
 * put in it is either the literal placeholder or the word "null", in a
 * message the owner is about to send to their friends. With an owner name
 * the quiz's own title is already that sentence; without one the playlist
 * has to be named, and without even that the title's playlist form is what
 * is left.
 */
export function ownerShareText(
  copy: QuizCopy,
  quiz: { ownerName: string | null; playlistName: string; questionCount: number | null }
): string {
  if (quiz.questionCount === null) {
    if (quiz.ownerName || !quiz.playlistName) return quizTitle(copy, quiz.ownerName);
    return fillCopy(copy.ownerShareTextPlaylistBare, { playlist: quiz.playlistName });
  }
  return quiz.ownerName
    ? fillCopy(copy.ownerShareTextOwner, { owner: quiz.ownerName, count: quiz.questionCount })
    : fillCopy(copy.ownerShareTextPlaylist, { playlist: quiz.playlistName, count: quiz.questionCount });
}

/**
 * What an owner's clipboard gets: the sentence, then the link.
 *
 * The share sheet is handed `text` and `url` as two fields and the chat app
 * puts them together; a clipboard has one field, and until 2026-09-30 the
 * owner's got the bare URL — so the 17 owners in 19 who copied rather than
 * shared pasted an address with no sentence, into a chat where the unfurled
 * card may or may not draw. The taker's share has always copied both
 * (`takerShareText`, then the URL), and this is the same shape for the same
 * reason. One helper, so the panel's two buttons and the board's two cannot
 * each compose it slightly differently.
 */
export function ownerClipboardText(
  copy: QuizCopy,
  quiz: { ownerName: string | null; playlistName: string; questionCount: number | null },
  url: string
): string {
  return `${ownerShareText(copy, quiz)} ${url}`;
}

/** The panel's caption over the playlist name: with the count, or without one to give. */
export function panelCaption(copy: QuizCopy, questionCount: number | null): string {
  return questionCount === null
    ? copy.panelQuizFrom
    : fillCopy(copy.panelQuestionsFrom, { count: questionCount });
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

/**
 * "3h ago" / "3 小時前", for the dashboard's last-answer line. Coarse on
 * purpose — the question is "has anyone answered since I last looked", not
 * the minute — and computed against `now` so the suite can pin it.
 */
export function relativeTime(ms: number, locale: ErrorLocale, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - ms) / 60000));
  const zh = locale === "zh";
  if (minutes < 1) return zh ? "剛剛" : "just now";
  if (minutes < 60) return zh ? `${minutes} 分鐘前` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return zh ? `${hours} 小時前` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return zh ? `${days} 天前` : `${days}d ago`;
}
