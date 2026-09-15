import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseLastQuiz,
  parseQuizTokens,
  pruneQuizTokens,
  quizUrl,
  recallLastQuiz,
  recallQuizToken,
  rememberLastQuiz,
  rememberQuizToken,
  QUIZ_TOKENS_MAX,
} from "@/lib/quiz-session";
import { QUIZ_TTL_SECONDS } from "@/types/quiz";
import { ROOM_CODE_ALPHABET } from "@/types/room";

/** A real six-character code: `0`, `O`, `1`, `I`, `L` are not in the alphabet. */
function letterCode(i: number): string {
  return `ABCDE${ROOM_CODE_ALPHABET[8 + i]}`;
}

const NOW = 1_800_000_000_000;

/**
 * jsdom gives us `window` but not `window.localStorage` here (see
 * tests/host-session.test.ts). Without the stub every `remember*` call takes
 * the "storage unavailable" branch and these tests would pass while testing
 * nothing, so the stub is what makes them mean anything.
 */
function installStorage(): Storage {
  const map = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, String(value)),
  };
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true, writable: true });
  return storage;
}

beforeEach(() => {
  installStorage();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseLastQuiz", () => {
  const good = { code: "ABC234", ownerName: "Wayn", playlistName: "P", createdAt: NOW - 1000, expiresAt: NOW + 1000 };

  it("reads a well-formed entry", () => {
    expect(parseLastQuiz(JSON.stringify(good), NOW)).toEqual(good);
  });

  it("drops an expired one, so the setup page never links to a dead quiz", () => {
    expect(parseLastQuiz(JSON.stringify({ ...good, expiresAt: NOW }), NOW)).toBeNull();
  });

  it("treats an expiry past the TTL as corruption rather than a longer quiz", () => {
    expect(parseLastQuiz(JSON.stringify({ ...good, expiresAt: NOW + (QUIZ_TTL_SECONDS + 1) * 1000 }), NOW)).toBeNull();
  });

  it("tolerates missing optional fields and rejects missing required ones", () => {
    expect(parseLastQuiz(JSON.stringify({ code: "ABC234", expiresAt: NOW + 1 }), NOW)).toEqual({
      code: "ABC234", ownerName: null, playlistName: "", createdAt: 0, expiresAt: NOW + 1,
    });
    expect(parseLastQuiz(JSON.stringify({ expiresAt: NOW + 1 }), NOW)).toBeNull();
    expect(parseLastQuiz(JSON.stringify({ code: "ABC234" }), NOW)).toBeNull();
  });

  it("rejects a code that is not six characters of the room alphabet, and canonicalises one that is", () => {
    // The code goes straight into `/q/<code>/board`; the sibling parser
    // (`parseQuizTokens`) already refused anything off the alphabet, and a
    // localStorage entry is no more trustworthy than a token.
    for (const code of ["../x", "ABC01O", "LONGCODE1", "<script>", "ABC23", ""]) {
      expect(parseLastQuiz(JSON.stringify({ code, expiresAt: NOW + 1 }), NOW), code).toBeNull();
    }
    expect(parseLastQuiz(JSON.stringify({ code: "abc234", expiresAt: NOW + 1 }), NOW)?.code).toBe("ABC234");
  });

  it("does not throw on garbage", () => {
    for (const raw of ["", "{", "null", "[]", "42", '"x"']) {
      expect(parseLastQuiz(raw, NOW)).toBeNull();
    }
  });
});

describe("quiz tokens", () => {
  it("reads only well-formed entries, in stored order", () => {
    const raw = JSON.stringify([
      { code: "ABC234", token: "t1", at: 5 },
      { code: "abc234", token: "lower", at: 6 },
      { code: "", token: "x", at: 7 },
      { code: "LONGCODE1", token: "y", at: 8 },
      { code: "ABC01O", token: "confusable", at: 9 },
      { code: "ZZZZZZ", token: 5, at: 10 },
      { code: "ZZZZZ2", token: "no-at" },
      "junk",
      null,
    ]);
    expect(parseQuizTokens(raw)).toEqual([
      { code: "ABC234", token: "t1", at: 5 },
      { code: "ZZZZZ2", token: "no-at", at: 0 },
    ]);
  });

  it("does not throw on garbage, including the old object shape", () => {
    for (const raw of [null, "", "{", "[]", "42", '"x"', "null", '{"ABC234":"t1"}']) {
      expect(parseQuizTokens(raw)).toEqual([]);
    }
  });

  it("keeps the most recently remembered entries when pruning, by timestamp", () => {
    const entries = Array.from({ length: QUIZ_TOKENS_MAX + 3 }, (_, i) => ({
      code: `C${String(i).padStart(5, "0")}`,
      token: `t${i}`,
      at: i,
    }));
    const pruned = pruneQuizTokens(entries);
    expect(pruned).toHaveLength(QUIZ_TOKENS_MAX);
    expect(pruned.map((e) => e.code)).not.toContain("C00000");
    expect(pruned[pruned.length - 1]).toEqual(entries[entries.length - 1]);
  });

  it("does not prune an all-digit code first just because JS orders integer-like keys first", () => {
    // Digits 2–9 are in the alphabet, so "234567" is a real code. Stored as
    // object keys it enumerated before every letter code and was pruned as
    // the "oldest" the moment the cap was hit.
    for (let i = 0; i < QUIZ_TOKENS_MAX; i += 1) {
      rememberQuizToken(letterCode(i), `t${i}`, 1000 + i);
    }
    rememberQuizToken("234567", "newest", 5000);
    expect(recallQuizToken("234567")).toBe("newest");
    expect(recallQuizToken(letterCode(0))).toBeNull();
    expect(recallQuizToken(letterCode(1))).toBe("t1");
  });
});

describe("the last quiz, on this device", () => {
  const quiz = { code: "ABC234", ownerName: "Wayn", playlistName: "P", createdAt: NOW - 1000, expiresAt: NOW + 60_000 };

  it("round-trips through storage and offers the entry back until it expires", () => {
    rememberLastQuiz(quiz);
    expect(recallLastQuiz(NOW)).toEqual(quiz);
    // One entry, not a history: a second remember replaces the first.
    rememberLastQuiz({ ...quiz, code: "XYZ789" });
    expect(recallLastQuiz(NOW)?.code).toBe("XYZ789");
  });

  it("removes an expired entry on read, so the setup page stops offering a dead link", () => {
    rememberLastQuiz(quiz);
    expect(recallLastQuiz(quiz.expiresAt)).toBeNull();
    expect(window.localStorage.getItem("guesssong_last_quiz")).toBeNull();
    // And junk is cleared the same way rather than re-read on every mount.
    window.localStorage.setItem("guesssong_last_quiz", "{");
    expect(recallLastQuiz(NOW)).toBeNull();
    expect(window.localStorage.getItem("guesssong_last_quiz")).toBeNull();
  });

  it("answers null and does not throw when storage is blocked", () => {
    // Safari with "Block All Cookies" throws on the access itself.
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => rememberLastQuiz(quiz)).not.toThrow();
    expect(recallLastQuiz(NOW)).toBeNull();
    expect(() => rememberQuizToken("ABC234", "t")).not.toThrow();
    expect(recallQuizToken("ABC234")).toBeNull();
  });
});

describe("the host tokens, on this device", () => {
  it("remembers a token under the upper-cased code and recalls it case-insensitively", () => {
    rememberQuizToken("abc234", "tok-1");
    expect(recallQuizToken("ABC234")).toBe("tok-1");
    expect(recallQuizToken("abc234")).toBe("tok-1");
    expect(recallQuizToken("ZZZZZZ")).toBeNull();
    expect(parseQuizTokens(window.localStorage.getItem("guesssong_quiz_tokens")).map((e) => e.code)).toEqual(["ABC234"]);
  });

  it("keeps the tokens of the last QUIZ_TOKENS_MAX quizzes and forgets the oldest", () => {
    // The board page has to work for the quiz before last too, but a device
    // is not an archive: past the cap the oldest token goes.
    const codes = Array.from({ length: QUIZ_TOKENS_MAX + 2 }, (_, i) => letterCode(i));
    codes.forEach((code, i) => rememberQuizToken(code, `t-${code}`, 1000 + i));
    expect(recallQuizToken(codes[0])).toBeNull();
    expect(recallQuizToken(codes[1])).toBeNull();
    expect(recallQuizToken(codes[2])).toBe(`t-${codes[2]}`);
    expect(recallQuizToken(codes[codes.length - 1])).toBe(`t-${codes[codes.length - 1]}`);
    expect(parseQuizTokens(window.localStorage.getItem("guesssong_quiz_tokens"))).toHaveLength(QUIZ_TOKENS_MAX);
  });

  it("survives a corrupt token map by starting over rather than throwing", () => {
    window.localStorage.setItem("guesssong_quiz_tokens", "[1,2");
    expect(recallQuizToken("ABC234")).toBeNull();
    rememberQuizToken("ABC234", "fresh");
    expect(recallQuizToken("ABC234")).toBe("fresh");
  });
});

describe("quizUrl", () => {
  it("upper-cases the code and uses this origin", () => {
    expect(quizUrl("abc234")).toBe(`${window.location.origin}/q/ABC234`);
  });
});
