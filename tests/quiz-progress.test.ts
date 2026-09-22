import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  QUIZ_PROGRESS_MAX,
  QUIZ_SUBMISSIONS_MAX,
  clearQuizProgress,
  findQuizSubmission,
  fitsQuizProgress,
  fitsQuizSubmission,
  parseQuizProgress,
  parseQuizSubmissions,
  pruneQuizEntries,
  quizHistoryState,
  readQuizHistoryStep,
  recallQuizProgress,
  recallQuizSubmissions,
  rememberQuizSubmission,
  saveQuizProgress,
  type QuizProgress,
  type QuizSubmission,
} from "@/lib/quiz-progress";
import { QUIZ_TTL_SECONDS } from "@/types/quiz";
import { installStorage } from "./helpers/storage";

const NOW = 1_800_000_000_000;
const PROGRESS_KEY = "guesssong_quiz_progress";
const SUBMISSIONS_KEY = "guesssong_quiz_submissions";


const quiz = {
  questionCount: 4,
  hintAllowance: 1,
  questions: [{ options: [1, 2] }, { options: [1, 2] }, { options: [1, 2] }, { options: [1, 2] }],
};

const progress: QuizProgress = {
  code: "ABC234",
  name: "Wayn",
  answers: [1, 0, -1, -1],
  revealed: [1, 1, -1, -1],
  index: 2,
  hintsLeft: 0,
  charged: [1],
  submissionId: "sid-1",
  expiresAt: NOW + 60_000,
  at: NOW - 1000,
};

const submission: QuizSubmission = {
  code: "ABC234",
  name: "Wayn",
  submissionId: "sid-1",
  answers: [1, 0, 1, 1],
  hintsUsed: 1,
  expiresAt: NOW + 60_000,
  at: NOW - 500,
};

beforeEach(() => {
  installStorage();
});

describe("the test environment itself", () => {
  it("really has storage, so the assertions below are not vacuous", () => {
    // jsdom supplies no localStorage here; every guarded call would take
    // its unavailable branch and pass. See tests/helpers/storage.ts.
    window.localStorage.setItem("canary", "1");
    expect(window.localStorage.getItem("canary")).toBe("1");
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseQuizProgress", () => {
  it("reads a well-formed entry and upper-cases the code", () => {
    expect(parseQuizProgress(JSON.stringify([{ ...progress, code: "abc234" }]), NOW)).toEqual([progress]);
  });

  it("drops an expired entry, so a dead quiz is never resumed", () => {
    expect(parseQuizProgress(JSON.stringify([{ ...progress, expiresAt: NOW }]), NOW)).toEqual([]);
    expect(parseQuizProgress(JSON.stringify([{ ...progress, expiresAt: NOW - 1 }]), NOW)).toEqual([]);
  });

  it("treats an expiry past the TTL as corruption rather than a longer quiz", () => {
    const raw = JSON.stringify([{ ...progress, expiresAt: NOW + (QUIZ_TTL_SECONDS + 1) * 1000 }]);
    expect(parseQuizProgress(raw, NOW)).toEqual([]);
  });

  it("tolerates the optional fields and rejects the ones a resume cannot do without", () => {
    const { charged: _charged, revealed: _revealed, at: _at, ...bare } = progress;
    // An entry saved before the reveal shipped has no `revealed`; it resumes, verdicts unknown.
    expect(parseQuizProgress(JSON.stringify([bare]), NOW)).toEqual([{ ...progress, charged: [], revealed: [], at: 0 }]);
    // A malformed optional field is dropped, not the entry: the resume is worth more than the free re-tap.
    expect(parseQuizProgress(JSON.stringify([{ ...progress, charged: "1" }]), NOW)).toEqual([{ ...progress, charged: [] }]);
    expect(parseQuizProgress(JSON.stringify([{ ...progress, revealed: [1, "x"] }]), NOW)).toEqual([{ ...progress, revealed: [] }]);
    for (const missing of ["code", "name", "answers", "index", "hintsLeft", "submissionId", "expiresAt"] as const) {
      const entry: Record<string, unknown> = { ...progress };
      delete entry[missing];
      expect(parseQuizProgress(JSON.stringify([entry]), NOW), missing).toEqual([]);
    }
    for (const bad of [
      { ...progress, name: "   " },
      { ...progress, answers: [1, "0"] },
      { ...progress, index: -1 },
      { ...progress, index: 1.5 },
      { ...progress, hintsLeft: -1 },
      { ...progress, submissionId: "" },
    ]) {
      expect(parseQuizProgress(JSON.stringify([bad]), NOW)).toEqual([]);
    }
  });

  it("does not throw on garbage, and keeps the good entries beside bad ones", () => {
    for (const raw of [null, "", "{", "null", "42", '"x"', "{}", "[1, null, \"x\"]"]) {
      expect(parseQuizProgress(raw, NOW)).toEqual([]);
    }
    expect(parseQuizProgress(JSON.stringify([null, "junk", progress, 7]), NOW)).toEqual([progress]);
  });
});

describe("fitsQuizProgress", () => {
  it("accepts an entry that matches the quiz as served", () => {
    expect(fitsQuizProgress(progress, quiz)).toBe(true);
    expect(
      fitsQuizProgress({ ...progress, answers: [-1, -1, -1, -1], revealed: [-1, -1, -1, -1], index: 0, hintsLeft: 1, charged: [] }, quiz)
    ).toBe(true);
    // No verdicts at all (an older entry), and a verdict withheld on an answered question (the check never got through).
    expect(fitsQuizProgress({ ...progress, revealed: [] }, quiz)).toBe(true);
    expect(fitsQuizProgress({ ...progress, revealed: [1, -1, -1, -1] }, quiz)).toBe(true);
  });

  it("refuses verdicts that do not fit the questions, or name one the taker never answered", () => {
    // A verdict is the key for that question, handed over only once it was
    // answered; one on an unanswered question is not something this page wrote.
    expect(fitsQuizProgress({ ...progress, revealed: [1, 1, -1] }, quiz)).toBe(false);
    expect(fitsQuizProgress({ ...progress, revealed: [2, 1, -1, -1] }, quiz)).toBe(false);
    expect(fitsQuizProgress({ ...progress, revealed: [1, 1, 0, -1] }, quiz)).toBe(false);
  });

  it("holds the verdicts to the same option range as the answers, and to answered questions only", () => {
    // Below -1 is not "not told", it is corruption — the same rule the
    // answers keep. And a verdict on the one unanswered slot at the end is
    // refused just as one in the middle is: the check is per question, not
    // "any answered question exists".
    expect(fitsQuizProgress({ ...progress, revealed: [-2, 1, -1, -1] }, quiz)).toBe(false);
    expect(fitsQuizProgress({ ...progress, answers: [1, 0, 1, -1], revealed: [1, 1, 0, -1] }, quiz)).toBe(true);
    expect(fitsQuizProgress({ ...progress, answers: [1, 0, 1, -1], revealed: [1, 1, 0, 0] }, quiz)).toBe(false);
    // Every question answered and every verdict known: the shape a reload on
    // the last dwell leaves behind, and the one that must resume.
    expect(fitsQuizProgress({ ...progress, answers: [1, 0, 1, 0], revealed: [1, 1, 0, 0], index: 3 }, quiz)).toBe(true);
  });

  it("lets a well-formed but wrong-length verdict list through parsing, and refuses it here", () => {
    // Parsing keeps any list of integers (an entry is worth more than its
    // optional field); the fit is where its length is held to this quiz's.
    // The two rules split so that a resume is never lost to the newer field.
    const [parsed] = parseQuizProgress(JSON.stringify([{ ...progress, revealed: [1, 1, -1] }]), NOW);
    expect(parsed.revealed).toEqual([1, 1, -1]);
    expect(fitsQuizProgress(parsed, quiz)).toBe(false);
  });

  it("refuses an entry from a quiz of another shape", () => {
    expect(fitsQuizProgress({ ...progress, answers: [1, 0, -1] }, quiz)).toBe(false);
    expect(fitsQuizProgress({ ...progress, index: 4 }, quiz)).toBe(false);
    expect(fitsQuizProgress({ ...progress, hintsLeft: 2 }, quiz)).toBe(false);
    expect(fitsQuizProgress({ ...progress, charged: [4] }, quiz)).toBe(false);
    expect(fitsQuizProgress({ ...progress, charged: [-1] }, quiz)).toBe(false);
    expect(fitsQuizProgress({ ...progress, answers: [2, 0, -1, -1] }, quiz)).toBe(false);
    expect(fitsQuizProgress({ ...progress, answers: [-2, 0, -1, -1] }, quiz)).toBe(false);
  });

  it("checks answers against each question's own option count, not the constant", () => {
    // A record built with four options, inside its week, still lays out.
    const wide = { ...quiz, questions: quiz.questions.map(() => ({ options: [1, 2, 3, 4] })) };
    expect(fitsQuizProgress({ ...progress, answers: [3, 2, -1, -1] }, wide)).toBe(true);
  });
});

describe("the quiz in progress, on this device", () => {
  it("round-trips through storage, one entry per code, and forgets it on clear", () => {
    saveQuizProgress(progress, NOW);
    expect(recallQuizProgress("abc234", NOW)).toEqual(progress);
    saveQuizProgress({ ...progress, index: 3, answers: [1, 0, 1, -1] }, NOW);
    expect(parseQuizProgress(window.localStorage.getItem(PROGRESS_KEY), NOW)).toHaveLength(1);
    expect(recallQuizProgress("ABC234", NOW)?.index).toBe(3);
    saveQuizProgress({ ...progress, code: "XYZ789" }, NOW);
    expect(recallQuizProgress("ABC234", NOW)?.index).toBe(3);
    clearQuizProgress("ABC234", NOW);
    expect(recallQuizProgress("ABC234", NOW)).toBeNull();
    expect(recallQuizProgress("XYZ789", NOW)).not.toBeNull();
    clearQuizProgress("XYZ789", NOW);
    expect(window.localStorage.getItem(PROGRESS_KEY)).toBeNull();
  });

  it("prunes an expired entry on the next write and never offers it back", () => {
    saveQuizProgress(progress, NOW);
    expect(recallQuizProgress("ABC234", progress.expiresAt)).toBeNull();
    saveQuizProgress({ ...progress, code: "XYZ789", expiresAt: progress.expiresAt + 60_000 }, progress.expiresAt);
    expect(parseQuizProgress(window.localStorage.getItem(PROGRESS_KEY), progress.expiresAt).map((e) => e.code)).toEqual([
      "XYZ789",
    ]);
  });

  it("keeps the QUIZ_PROGRESS_MAX most recently saved", () => {
    for (let i = 0; i < QUIZ_PROGRESS_MAX + 2; i += 1) {
      saveQuizProgress({ ...progress, code: `C${String(i).padStart(5, "0")}`, at: NOW + i }, NOW);
    }
    expect(recallQuizProgress("C00000", NOW)).toBeNull();
    expect(recallQuizProgress("C00001", NOW)).toBeNull();
    expect(recallQuizProgress("C00002", NOW)).not.toBeNull();
    expect(recallQuizProgress(`C${String(QUIZ_PROGRESS_MAX + 1).padStart(5, "0")}`, NOW)).not.toBeNull();
  });

  it("survives corrupt storage by starting over rather than throwing", () => {
    window.localStorage.setItem(PROGRESS_KEY, "[1,2");
    expect(recallQuizProgress("ABC234", NOW)).toBeNull();
    saveQuizProgress(progress, NOW);
    expect(recallQuizProgress("ABC234", NOW)).toEqual(progress);
  });

  it("answers null and does not throw when storage is blocked", () => {
    // Safari with "Block All Cookies" throws on the access itself.
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => saveQuizProgress(progress, NOW)).not.toThrow();
    expect(recallQuizProgress("ABC234", NOW)).toBeNull();
    expect(() => clearQuizProgress("ABC234", NOW)).not.toThrow();
    expect(() => rememberQuizSubmission(submission, NOW)).not.toThrow();
    expect(recallQuizSubmissions("ABC234", NOW)).toEqual([]);
  });
});

describe("parseQuizSubmissions", () => {
  it("reads a well-formed entry, defaults the hints, and drops the rest", () => {
    const { hintsUsed: _h, at: _at, ...bare } = submission;
    expect(parseQuizSubmissions(JSON.stringify([submission, bare]), NOW)).toEqual([
      submission,
      { ...submission, hintsUsed: 0, at: 0 },
    ]);
    for (const missing of ["code", "name", "submissionId", "answers", "expiresAt"] as const) {
      const entry: Record<string, unknown> = { ...submission };
      delete entry[missing];
      expect(parseQuizSubmissions(JSON.stringify([entry]), NOW), missing).toEqual([]);
    }
    expect(parseQuizSubmissions(JSON.stringify([{ ...submission, expiresAt: NOW }]), NOW)).toEqual([]);
    expect(parseQuizSubmissions(JSON.stringify([{ ...submission, hintsUsed: -1 }]), NOW)[0]?.hintsUsed).toBe(0);
  });

  it("does not throw on garbage", () => {
    for (const raw of [null, "", "{", "null", "42", '"x"', "{}", "[null]"]) {
      expect(parseQuizSubmissions(raw, NOW)).toEqual([]);
    }
  });
});

describe("fitsQuizSubmission", () => {
  it("demands the exact shape the server grades before it looks for the row", () => {
    expect(fitsQuizSubmission(submission, quiz)).toBe(true);
    expect(fitsQuizSubmission({ ...submission, answers: [1, 0, 1] }, quiz)).toBe(false);
    // A replay resends the answers, and `-1` is what an unfinished quiz holds.
    expect(fitsQuizSubmission({ ...submission, answers: [1, 0, 1, -1] }, quiz)).toBe(false);
    expect(fitsQuizSubmission({ ...submission, answers: [1, 0, 1, 2] }, quiz)).toBe(false);
  });
});

describe("the finished quizzes, on this device", () => {
  it("keeps one row per code and folded name, most recent first", () => {
    rememberQuizSubmission(submission, NOW);
    rememberQuizSubmission({ ...submission, name: "Bo", submissionId: "sid-2", at: NOW }, NOW);
    // The same person again, as the server would fold it: replaces, not appends.
    rememberQuizSubmission({ ...submission, name: "  wayn ", submissionId: "sid-3", at: NOW + 1 }, NOW);
    const rows = recallQuizSubmissions("abc234", NOW);
    expect(rows.map((r) => r.submissionId)).toEqual(["sid-3", "sid-2"]);
    expect(recallQuizSubmissions("XYZ789", NOW)).toEqual([]);
  });

  it("finds the stored row a typed name belongs to, by the server's own fold", () => {
    const rows = [submission, { ...submission, name: "Bo", submissionId: "sid-2" }];
    expect(findQuizSubmission(rows, " WAYN ")?.submissionId).toBe("sid-1");
    expect(findQuizSubmission(rows, "bo")?.submissionId).toBe("sid-2");
    expect(findQuizSubmission(rows, "Cy")).toBeNull();
    expect(findQuizSubmission(rows, "   ")).toBeNull();
  });

  it("prunes by expiry and keeps the QUIZ_SUBMISSIONS_MAX most recent", () => {
    rememberQuizSubmission({ ...submission, code: "OLD234", expiresAt: NOW + 1 }, NOW);
    for (let i = 0; i < QUIZ_SUBMISSIONS_MAX + 1; i += 1) {
      rememberQuizSubmission({ ...submission, code: `C${String(i).padStart(5, "0")}`, at: NOW + 10 + i }, NOW + 5);
    }
    const kept = parseQuizSubmissions(window.localStorage.getItem(SUBMISSIONS_KEY), NOW + 5);
    expect(kept).toHaveLength(QUIZ_SUBMISSIONS_MAX);
    expect(kept.map((e) => e.code)).not.toContain("OLD234");
    expect(kept.map((e) => e.code)).not.toContain("C00000");
    expect(recallQuizSubmissions(`C${String(QUIZ_SUBMISSIONS_MAX).padStart(5, "0")}`, NOW + 5)).toHaveLength(1);
  });

  it("survives a corrupt list by starting over rather than throwing", () => {
    window.localStorage.setItem(SUBMISSIONS_KEY, '{"ABC234":"x"}');
    expect(recallQuizSubmissions("ABC234", NOW)).toEqual([]);
    rememberQuizSubmission(submission, NOW);
    expect(recallQuizSubmissions("ABC234", NOW)).toEqual([submission]);
  });
});

describe("pruneQuizEntries", () => {
  it("keeps the newest by timestamp regardless of stored order", () => {
    const entries = [{ at: 5 }, { at: 1 }, { at: 9 }, { at: 3 }];
    expect(pruneQuizEntries(entries, 2)).toEqual([{ at: 5 }, { at: 9 }]);
    expect(pruneQuizEntries(entries, 10)).toHaveLength(4);
    expect(pruneQuizEntries([], 3)).toEqual([]);
  });
});

describe("the history entry a question stands for", () => {
  it("round-trips a step through the state object and ignores other quizzes' entries", () => {
    const state = quizHistoryState("abc234", 3, 4);
    expect(readQuizHistoryStep(state, "ABC234")).toEqual({ step: 3, depth: 4 });
    expect(readQuizHistoryStep(state, "abc234")).toEqual({ step: 3, depth: 4 });
    expect(readQuizHistoryStep(state, "XYZ789")).toBeNull();
  });

  it("survives Next.js copying its own fields into the same object", () => {
    const state = { ...quizHistoryState("ABC234", 0, 1), __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: [] };
    expect(readQuizHistoryStep(state, "ABC234")).toEqual({ step: 0, depth: 1 });
  });

  it("reads nothing from an entry that is not this quiz's", () => {
    for (const state of [null, undefined, {}, { __NA: true }, "x", 3, { guesssongQuiz: null }, { guesssongQuiz: "3" }]) {
      expect(readQuizHistoryStep(state, "ABC234")).toBeNull();
    }
    for (const bad of [
      { code: "ABC234", step: -1, depth: 1 },
      { code: "ABC234", step: 1.5, depth: 1 },
      { code: "ABC234", step: 1, depth: 0 },
      { code: "ABC234", step: "1", depth: 1 },
      { code: 3, step: 1, depth: 1 },
      { step: 1, depth: 1 },
    ]) {
      expect(readQuizHistoryStep({ guesssongQuiz: bad }, "ABC234"), JSON.stringify(bad)).toBeNull();
    }
  });
});
