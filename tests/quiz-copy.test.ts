// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  QUIZ_COPY,
  fillCopy,
  ownerClipboardText,
  ownerShareText,
  panelCaption,
  quizTitle,
  takerShareText,
  type QuizCopy,
} from "@/lib/quiz-copy";

/**
 * What the owner's side of the quiz says: the sentence that goes out with
 * the link, the panel's caption, the form, and the preview.
 *
 * `tests/quiz.test.ts` holds the table to its two general rules — the same
 * placeholders in both languages, no English in the Chinese half — for every
 * key, these included. This file is the rules that are about particular
 * sentences: what each has to say, and what it must never print.
 */

const LOCALES = ["en", "zh"] as const;
const URL = "https://www.guessong.app/q/ABC234";

/** Nothing a reader would see as a bug: an unfilled slot, or a value that was never a word. */
function expectClean(text: string, label: string) {
  expect(text, label).not.toMatch(/\{\w+\}/);
  expect(text, label).not.toMatch(/undefined|null|NaN/);
  expect(text.trim(), label).toBe(text);
  expect(text, label).not.toMatch(/\s{2,}/);
  expect(text.length, label).toBeGreaterThan(0);
}

describe("ownerShareText", () => {
  it("names the owner and the length when it has both", () => {
    expect(ownerShareText(QUIZ_COPY.en, { ownerName: "Wayn", playlistName: "Late nights", questionCount: 10 })).toBe(
      "How well do you know Wayn's music taste? 10 questions."
    );
    expect(ownerShareText(QUIZ_COPY.zh, { ownerName: "Wayn", playlistName: "Late nights", questionCount: 10 })).toBe(
      "你有多懂 Wayn 的音樂品味？共 10 題。"
    );
    expect(ownerShareText(QUIZ_COPY.en, { ownerName: null, playlistName: "Late nights", questionCount: 20 })).toBe(
      'How well do you know the "Late nights" playlist? 20 questions.'
    );
  });

  it("says less, never 'null questions', for a quiz whose length this device did not keep", () => {
    // `LastQuiz.questionCount` is null on an entry written before it was
    // stored, and the panel drawn from that entry has a Send button. The
    // sentence is about to go to the owner's friends.
    for (const locale of LOCALES) {
      const copy = QUIZ_COPY[locale];
      const named = ownerShareText(copy, { ownerName: "Wayn", playlistName: "Late nights", questionCount: null });
      expect(named, locale).toBe(quizTitle(copy, "Wayn"));
      expect(named, locale).toContain("Wayn");
      expectClean(named, locale);

      const unnamed = ownerShareText(copy, { ownerName: null, playlistName: "Late nights", questionCount: null });
      expect(unnamed, locale).toContain("Late nights");
      expectClean(unnamed, locale);

      // Neither name: an entry somebody edited. Still a sentence.
      const bare = ownerShareText(copy, { ownerName: null, playlistName: "", questionCount: null });
      expect(bare, locale).toBe(copy.introTitlePlaylist);
      expectClean(bare, locale);

      for (const text of [named, unnamed, bare]) expect(text, locale).not.toMatch(/\d/);
    }
  });

  it("is the counted sentence minus its count — the bare form does not drift from the full one", () => {
    // Two strings that say the same thing are two chances for one to be
    // reworded alone. The bare playlist sentence is a prefix of the full one.
    for (const locale of LOCALES) {
      const copy = QUIZ_COPY[locale];
      const full = fillCopy(copy.ownerShareTextPlaylist, { playlist: "P", count: 10 });
      const bare = fillCopy(copy.ownerShareTextPlaylistBare, { playlist: "P" });
      expect(full.startsWith(bare), locale).toBe(true);
      const owned = fillCopy(copy.ownerShareTextOwner, { owner: "W", count: 10 });
      expect(owned.startsWith(quizTitle(copy, "W")), locale).toBe(true);
    }
  });
});

describe("ownerClipboardText", () => {
  it("is the sentence, a space, and the link — the shape the taker's share has always copied", () => {
    for (const locale of LOCALES) {
      const copy = QUIZ_COPY[locale];
      for (const quiz of [
        { ownerName: "Wayn", playlistName: "Late nights", questionCount: 10 },
        { ownerName: null, playlistName: "Late nights", questionCount: 30 },
        { ownerName: "Wayn", playlistName: "Late nights", questionCount: null },
        { ownerName: null, playlistName: "", questionCount: null },
      ]) {
        const text = ownerClipboardText(copy, quiz, URL);
        expect(text, locale).toBe(`${ownerShareText(copy, quiz)} ${URL}`);
        // The link is last and whole, so a chat app still finds and unfurls it.
        expect(text.endsWith(` ${URL}`), locale).toBe(true);
        expect(text.match(/https?:\/\//g), locale).toHaveLength(1);
        expectClean(text, locale);
      }
      // The same composition as the taker's, which the owner's used to lack.
      const taker = takerShareText(copy, { ownerName: "Wayn", playlistName: "P" }, { correct: 7, total: 10 });
      expect(`${taker} ${URL}`.endsWith(` ${URL}`)).toBe(true);
    }
  });

  it("is never the bare address", () => {
    for (const locale of LOCALES) {
      const text = ownerClipboardText(QUIZ_COPY[locale], { ownerName: null, playlistName: "", questionCount: null }, URL);
      expect(text, locale).not.toBe(URL);
      expect(text.length, locale).toBeGreaterThan(URL.length + 5);
    }
  });
});

describe("panelCaption", () => {
  it("gives the count when there is one and a caption without a number when there is not", () => {
    for (const locale of LOCALES) {
      const copy = QUIZ_COPY[locale];
      expect(panelCaption(copy, 20), locale).toBe(fillCopy(copy.panelQuestionsFrom, { count: 20 }));
      expect(panelCaption(copy, 20), locale).toContain("20");
      const unknown = panelCaption(copy, null);
      expect(unknown, locale).toBe(copy.panelQuizFrom);
      expectClean(unknown, locale);
      expect(unknown, locale).not.toMatch(/\d/);
    }
  });
});

describe("the sentences that have one job each", () => {
  const each = (check: (copy: QuizCopy, locale: (typeof LOCALES)[number]) => void) => {
    for (const locale of LOCALES) check(QUIZ_COPY[locale], locale);
  };

  it("tells the owner both things about a preview: not saved, and not shown", () => {
    // An owner's two worries, and a sentence that drops either leaves one.
    expect(QUIZ_COPY.en.previewIntro).toMatch(/aren't saved/);
    expect(QUIZ_COPY.en.previewIntro).toMatch(/leaderboard/);
    expect(QUIZ_COPY.zh.previewIntro).toMatch(/不會存/);
    expect(QUIZ_COPY.zh.previewIntro).toMatch(/排行榜/);
    expect(QUIZ_COPY.en.previewResultNote).toMatch(/wasn't saved/);
    expect(QUIZ_COPY.en.previewResultNote).toMatch(/friends/);
    expect(QUIZ_COPY.zh.previewResultNote).toMatch(/沒有存/);
    expect(QUIZ_COPY.zh.previewResultNote).toMatch(/朋友/);
  });

  it("does not tell a previewing owner the board is full", () => {
    // Both are "not recorded"; they are not the same reason.
    each((copy, locale) => {
      expect(copy.previewResultNote, locale).not.toBe(copy.boardFull);
    });
    expect(QUIZ_COPY.en.previewResultNote).not.toMatch(/full/i);
    expect(QUIZ_COPY.zh.previewResultNote).not.toMatch(/滿/);
  });

  it("says, under the length picker, who answers and which lengths get finished", () => {
    expect(QUIZ_COPY.en.createLengthNote).toMatch(/friends/i);
    expect(QUIZ_COPY.en.createLengthNote).toMatch(/short/i);
    expect(QUIZ_COPY.en.createLengthNote).toMatch(/finish/i);
    expect(QUIZ_COPY.zh.createLengthNote).toMatch(/朋友/);
    expect(QUIZ_COPY.zh.createLengthNote).toMatch(/少/);
    expect(QUIZ_COPY.zh.createLengthNote).toMatch(/做完/);
    // A sentence, not a number: the default is being measured and the note
    // must not name one that a later change to it would make false.
    each((copy, locale) => expect(copy.createLengthNote, locale).not.toMatch(/\d/));
  });

  it("fills the form's two templated lines without a slot left over", () => {
    each((copy, locale) => {
      const label = fillCopy(copy.createCustomCountLabel, { min: 10, max: 50 });
      expect(label, locale).toContain("10");
      expect(label, locale).toContain("50");
      expectClean(label, locale);
      // The title preview wraps the friend's own title string, so what the
      // owner reads under the name box is what the friend will read.
      for (const owner of ["Wayn", "…"]) {
        const preview = fillCopy(copy.createTitlePreview, { title: fillCopy(copy.introTitleOwner, { owner }) });
        expect(preview, locale).toContain(quizTitle(copy, owner));
        expect(preview, locale).not.toMatch(/\{\w+\}/);
      }
    });
  });

  it("words the two create buttons differently, and the second as a second link", () => {
    each((copy, locale) => {
      expect(copy.createButton, locale).not.toBe(copy.createAgainButton);
    });
    expect(QUIZ_COPY.en.createAgainButton).toMatch(/new/i);
    expect(QUIZ_COPY.zh.createAgainButton).toMatch(/新|再/);
  });

  it("names the preview as one on the panel, in words that are not the results link's", () => {
    each((copy, locale) => {
      expect(copy.panelPreviewLink, locale).not.toBe(copy.panelBoardLink);
      expect(copy.previewStart, locale).not.toBe(copy.startButton);
    });
    expect(QUIZ_COPY.en.panelPreviewLink).toBe("Preview your quiz →");
  });
});
