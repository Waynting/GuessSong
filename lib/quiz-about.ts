/**
 * The words under the form on `/quiz`: how it works and the FAQ, in both
 * languages the site ships.
 *
 * In `lib/` rather than beside the page for the reason `lib/song-count.ts`
 * gives — the suite reaches `lib/` — and as one `Record<ErrorLocale, …>` so a
 * missing translation is a compile error, the `lib/quiz-copy.ts` rule.
 *
 * The page is prerendered in English and switches after mount, the way the
 * form above it does (`useErrorLocale`): a crawler reads English, and the
 * JSON-LD in app/quiz/page.tsx is built from `QUIZ_ABOUT.en`, so the
 * structured data always says what the prerendered page says. Before this the
 * form switched and these did not, and a Taiwanese host read a Chinese form
 * over an English explainer.
 *
 * Every claim is a rule in lib/quiz.ts or types/quiz.ts — two options, 10–50
 * questions, a week, fifty on the board — and `tests/quiz-mine.test.ts` pins
 * the English half against those constants.
 */

import type { ErrorLocale } from "@/lib/error-messages";

export interface QuizAboutCopy {
  howTitle: string;
  steps: { title: string; text: string }[];
  faqTitle: string;
  faqs: { q: string; a: string }[];
  /** The closing line, around two links: the party game and the guides. */
  closing: { before: string; party: string; middle: string; guides: string; after: string };
  /** Where "the party game" goes: the landing page in this language. */
  partyHref: string;
}

export const QUIZ_ABOUT: Record<ErrorLocale, QuizAboutCopy> = {
  en: {
    howTitle: "How the taste quiz works",
    steps: [
      {
        title: "Paste a public Spotify playlist",
        text: "Any playlist you made or follow works, as long as it is public. Add your name so the quiz says whose taste it is, and pick 10 to 50 questions.",
      },
      {
        title: "Send the link to your group chat",
        text: "You get one short link and a QR code. Friends open it on their phone, with no app and no sign-up, and the preview card in the chat already names you.",
      },
      {
        title: "Friends pick the song that is really yours",
        text: "Each question shows two songs and only one is in your playlist. Every answer shows right or wrong straight away, and a score and a verdict come at the end.",
      },
      {
        title: "Watch the results come in",
        text: "A leaderboard ranks everyone who took it. On the device that made the quiz you also see which songs everyone knew and which ones nobody could place.",
      },
    ],
    faqTitle: "Questions about the quiz",
    faqs: [
      {
        q: "Is the Spotify playlist quiz free?",
        a: "Yes. There is no account, no login and no app to install, for you or for the friends who take it.",
      },
      {
        q: "Where do the wrong answers come from?",
        a: "Never from your playlist. They are real songs picked to sound plausible next to yours, by the same artists or in the same language where possible.",
      },
      {
        q: "How long does the quiz link last?",
        a: "One week. Up to fifty friends can take it and land on the leaderboard in that time.",
      },
      {
        q: "How do I see who took my quiz?",
        a: "Open My quizzes on the phone or computer you made it on. There is no account, so that browser is what proves the quiz is yours.",
      },
    ],
    closing: {
      before: "Rather play out loud, all in one room? The ",
      party: "guess the song party game",
      middle: " plays clips from the same kind of playlist, and the ",
      guides: "guides",
      after: " cover picking a playlist that plays well.",
    },
    partyHref: "/",
  },
  zh: {
    howTitle: "品味鑒定怎麼玩",
    steps: [
      {
        title: "貼上一個公開的 Spotify 歌單",
        text: "自己建的、追蹤的歌單都可以，只要是公開的。填上你的名字，測驗就會寫明是誰的品味；題數可以選 10 到 50 題。",
      },
      {
        title: "把連結丟進群組",
        text: "你會拿到一條短連結和一個 QR code。朋友用手機直接打開，不用裝 App、不用註冊，聊天室裡的預覽卡片就會寫出你的名字。",
      },
      {
        title: "朋友猜哪一首才是你的歌",
        text: "每題兩首歌，只有一首真的在你的歌單裡。每答一題馬上知道對錯，最後會拿到分數和一句評語。",
      },
      {
        title: "看結果一個個進來",
        text: "排行榜會列出每個作答的人。在做測驗的那台裝置上，還能看到哪首歌大家都猜對、哪首歌沒人認得出來。",
      },
    ],
    faqTitle: "常見問題",
    faqs: [
      {
        q: "品味鑒定要錢嗎？",
        a: "完全免費。不用帳號、不用登入、不用裝 App，你和作答的朋友都一樣。",
      },
      {
        q: "錯的選項是從哪裡來的？",
        a: "絕對不會是你歌單裡的歌。它們是真實存在、放在你的歌旁邊也說得通的歌，盡量挑同一位歌手或同一種語言。",
      },
      {
        q: "測驗連結可以用多久？",
        a: "一週。這段時間內最多五十位朋友可以作答並登上排行榜。",
      },
      {
        q: "怎麼看誰做了我的測驗？",
        a: "在你做測驗的那支手機或那台電腦上打開「我的測驗」。因為沒有帳號，那個瀏覽器就是證明測驗是你的東西。",
      },
    ],
    closing: {
      before: "比較想大家在同一個空間一起玩？",
      party: "猜歌派對遊戲",
      middle: "用的也是 Spotify 歌單；",
      guides: "遊戲指南（英文）",
      after: "裡有挑一份好玩歌單的方法。",
    },
    partyHref: "/zh",
  },
};
