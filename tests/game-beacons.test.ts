import { describe, it, expect } from "vitest";
import { claimFirstPage, gameFingerprint, hostKindOf } from "@/lib/game-beacons";
import { GAME_HOST_KINDS } from "@/lib/loop-stats";

/** A Storage that works, backed by a Map. */
function workingStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

/** Safari with "Block All Cookies": every call throws. */
function refusingStorage(): Storage {
  const refuse = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  return { getItem: refuse, setItem: refuse, removeItem: refuse, clear: refuse, key: refuse, length: 0 } as Storage;
}

describe("the host kind on the end beacon", () => {
  it("is first for a device's first game and repeat from the second", () => {
    // The start on `/` bumps the count before it navigates to the game, so
    // the count the game page reads is this game's 1-based index.
    expect(hostKindOf(1)).toBe("first");
    expect(hostKindOf(2)).toBe("repeat");
    expect(hostKindOf(37)).toBe("repeat");
  });

  it("is unknown, never first, when the count could not be read", () => {
    // Zero is what `getHostGameCount` answers when storage refuses. A game
    // that started normally cannot have it, so it means "could not tell" —
    // and filing those under `first` would put every locked-down browser
    // into the bucket the question is about.
    for (const unreadable of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(hostKindOf(unreadable)).toBe("unknown");
    }
  });

  it("only ever answers with a kind the server will key", () => {
    for (const count of [-3, 0, 1, 2, 10, 1e9, Number.NaN]) {
      expect(GAME_HOST_KINDS).toContain(hostKindOf(count));
    }
  });
});

describe("a game is told from its reload", () => {
  const shuffled = (...ids: string[]) => ids.map((id) => ({ id }));

  it("fingerprints the same game the same way", () => {
    const tracks = shuffled("a", "b", "c", "d");
    expect(gameFingerprint(tracks, 3)).toBe(gameFingerprint(shuffled("a", "b", "c", "d"), 3));
  });

  it("tells two games of one playlist apart by their shuffle", () => {
    expect(gameFingerprint(shuffled("a", "b", "c", "d"), 3)).not.toBe(
      gameFingerprint(shuffled("c", "a", "d", "b"), 3)
    );
  });

  it("tells the same shuffle apart by the host's game count", () => {
    // Play Again, same playlist, and the one-in-thousands same first three.
    const tracks = shuffled("a", "b", "c", "d");
    expect(gameFingerprint(tracks, 3)).not.toBe(gameFingerprint(tracks, 4));
  });

  it("copes with a game shorter than the fingerprint is long", () => {
    expect(gameFingerprint(shuffled("a"), 1)).not.toBe(gameFingerprint(shuffled("b"), 1));
    expect(() => gameFingerprint([], 0)).not.toThrow();
  });

  it("claims a game's first page and refuses its reload", () => {
    const storage = workingStorage();
    const game = gameFingerprint(shuffled("a", "b", "c"), 1);
    expect(claimFirstPage(storage, game)).toBe(true);
    expect(claimFirstPage(storage, game)).toBe(false);
    expect(claimFirstPage(storage, game)).toBe(false);
  });

  it("claims the next game in the same tab", () => {
    // Play Again is a genuine second game and must send its own beacons.
    const storage = workingStorage();
    expect(claimFirstPage(storage, gameFingerprint(shuffled("a", "b", "c"), 1))).toBe(true);
    expect(claimFirstPage(storage, gameFingerprint(shuffled("b", "c", "a"), 2))).toBe(true);
  });

  it("counts the page when the browser will not say, rather than dropping its beacons", () => {
    // Over-counting understates a rate, which cannot manufacture a success.
    expect(claimFirstPage(null, "x")).toBe(true);
    const storage = refusingStorage();
    expect(() => claimFirstPage(storage, "x")).not.toThrow();
    expect(claimFirstPage(storage, "x")).toBe(true);
    expect(claimFirstPage(storage, "x")).toBe(true);
  });
});
