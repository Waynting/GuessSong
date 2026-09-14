import { describe, it, expect } from "vitest";
import {
  buildQuiz,
  bucketPool,
  clampHintsUsed,
  clampQuestionCount,
  creditedArtists,
  displayArtist,
  displayTitle,
  foldQuizName,
  gradeAnswers,
  hintAllowance,
  isAnswerList,
  pickBoardTiles,
  pickDecoys,
  rankOf,
  scriptBucket,
  seededRng,
  songKey,
  sortScoreboard,
  stripAnswerKey,
  summarizeBoard,
  usableQuizTracks,
  verdictFor,
  isQuizVerdict,
  BOARD_TILE_MIN_ANSWERED,
  DECOY_POPULARITY_WINDOW,
  QUIZ_VERDICTS,
  type DecoyEntry,
} from "@/lib/quiz";
import { QUIZ_COPY, fillCopy, hintWord } from "@/lib/quiz-copy";
import { QUIZ_DECOY_POOL } from "@/lib/quiz-decoys";
import {
  QUIZ_DEFAULT_QUESTION_COUNT,
  QUIZ_MAX_QUESTIONS,
  QUIZ_MIN_QUESTIONS,
  QUIZ_OPTION_COUNT,
  QUIZ_QUESTION_COUNTS,
  type QuizScore,
} from "@/types/quiz";
import type { Track } from "@/types";

function track(id: string, name: string, artists: string[], popularity?: number): Track {
  return {
    id,
    name,
    artists,
    durationMs: 200000,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...(popularity === undefined ? {} : { popularity }),
  };
}

/** A small pool with every tier represented. */
const POOL: DecoyEntry[] = [
  { name: "Save Your Tears", artist: "The Weeknd", popularity: 82 },
  { name: "Starboy", artist: "The Weeknd", popularity: 84 },
  { name: "Blinding Lights", artist: "The Weeknd", popularity: 88 },
  { name: "Levitating", artist: "Dua Lipa", popularity: 80 },
  { name: "Physical", artist: "Dua Lipa", popularity: 72 },
  { name: "Creep", artist: "Radiohead", popularity: 84 },
  { name: "Yesterday", artist: "The Beatles", popularity: 76 },
  { name: "Hey Jude", artist: "The Beatles", popularity: 78 },
  { name: "Hello", artist: "Adele", popularity: 78 },
  { name: "晴天", artist: "周杰倫", popularity: 80 },
  { name: "七里香", artist: "周杰倫", popularity: 78 },
  { name: "溫柔", artist: "五月天", popularity: 74 },
  { name: "小幸運", artist: "田馥甄", popularity: 76 },
  { name: "夜に駆ける", artist: "YOASOBI", popularity: 80 },
  { name: "Dynamite", artist: "BTS", popularity: 82 },
  { name: "봄날", artist: "BTS", popularity: 72 },
];

describe("scriptBucket", () => {
  it("reads Hangul as ko, kana as ja, ideographs alone as zh, else latin", () => {
    expect(scriptBucket("BTS", "봄날")).toBe("ko");
    expect(scriptBucket("YOASOBI", "夜に駆ける")).toBe("ja");
    expect(scriptBucket("周杰倫", "晴天")).toBe("zh");
    expect(scriptBucket("Adele", "Hello")).toBe("latin");
  });

  it("lets the artist decide when the title is in Latin script", () => {
    // Mandopop with an English title is still Mandopop.
    expect(scriptBucket("周杰倫", "Mojito")).toBe("zh");
    // A K-pop act credited in Latin with a Latin title is `latin` — on both
    // sides of the pool, which is what keeps the two consistent.
    expect(scriptBucket("BTS", "Dynamite")).toBe("latin");
  });

  it("prefers kana over ideographs so a kanji+kana title is ja", () => {
    expect(scriptBucket("米津玄師", "感電")).toBe("zh"); // kanji only: the cheaper mistake
    expect(scriptBucket("米津玄師", "打上花火")).toBe("zh");
    expect(scriptBucket("あいみょん", "マリーゴールド")).toBe("ja");
  });

  it("tolerates missing parts", () => {
    expect(scriptBucket(undefined, "")).toBe("latin");
  });
});

describe("displayTitle", () => {
  it("strips a trailing Spotify qualifier so the real answer has no tell", () => {
    expect(displayTitle("Karma Police - Remastered 2011")).toBe("Karma Police");
    expect(displayTitle("Señorita (feat. Camila Cabello)")).toBe("Señorita");
    expect(displayTitle("Something [Live]")).toBe("Something");
  });

  it("keeps hyphenated words and leading bracket groups", () => {
    expect(displayTitle("Hip-Hop Is Dead")).toBe("Hip-Hop Is Dead");
    expect(displayTitle("(Sittin' On) The Dock of the Bay")).toBe("(Sittin' On) The Dock of the Bay");
  });

  it("never returns an empty title", () => {
    expect(displayTitle("(Intro)")).toBe("(Intro)");
    expect(displayTitle("   ")).toBe("");
  });
});

describe("songKey and foldQuizName", () => {
  it("keys the same recording under one key regardless of case, spacing and qualifiers", () => {
    expect(songKey("Hello - Live", "Adele")).toBe(songKey("hello", "ADELE "));
    expect(songKey("Hello", "Adele")).not.toBe(songKey("Hello", "Lionel Richie"));
  });

  it("folds names the way the room roster does", () => {
    expect(foldQuizName("  Alice ")).toBe("alice");
  });
});

describe("pickDecoys", () => {
  function ctxFor(tracks: Track[]) {
    const playlistTitles = new Set(tracks.map((t) => displayTitle(t.name).toLowerCase()));
    return { playlistTitles, playlistArtists: creditedArtists(tracks), pool: bucketPool(POOL), used: new Set<string>() };
  }

  // Production asks for QUIZ_OPTION_COUNT - 1, which is one, and at one only
  // the first tier with anything ever shows. The order is what these tests
  // pin, so they ask for three and watch it fall through.
  const THREE = 3;

  it("at the production count, the first tier with anything decides the question", () => {
    expect(QUIZ_OPTION_COUNT - 1).toBe(1);
    const tracks = [track("1", "Die For You", ["The Weeknd"], 80), track("2", "New Rules", ["Dua Lipa"], 76)];
    for (let seed = 0; seed < 10; seed += 1) {
      const decoys = pickDecoys(
        { name: "Die For You", artist: "The Weeknd", popularity: 80 },
        ctxFor(tracks),
        seededRng(seed)
      );
      expect(decoys).toHaveLength(1);
      // Same artist, every time: the hardest shape a two-option question has.
      expect(decoys[0].artist).toBe("The Weeknd");
      expect(decoys[0].title).not.toBe("Die For You");
    }
  });

  it("prefers another song by the same artist, then by any artist in the playlist", () => {
    const tracks = [track("1", "Die For You", ["The Weeknd"], 80), track("2", "New Rules", ["Dua Lipa"], 76)];
    const decoys = pickDecoys(
      { name: "Die For You", artist: "The Weeknd", popularity: 80 },
      ctxFor(tracks),
      seededRng(1),
      THREE
    );
    expect(decoys).toHaveLength(3);
    // Three Weeknd songs are available and none is in the playlist.
    expect(decoys.every((d) => d.artist === "The Weeknd")).toBe(true);
  });

  it("falls to the other playlist artists when the same artist runs out", () => {
    const tracks = [
      track("1", "Save Your Tears", ["The Weeknd"], 80),
      track("2", "Starboy", ["The Weeknd"], 80),
      track("3", "New Rules", ["Dua Lipa"], 76),
    ];
    const decoys = pickDecoys(
      { name: "Save Your Tears", artist: "The Weeknd", popularity: 80 },
      ctxFor(tracks),
      seededRng(2),
      THREE
    );
    const artists = decoys.map((d) => d.artist);
    // Only Blinding Lights is left for tier 1; the rest come from Dua Lipa.
    expect(artists).toContain("The Weeknd");
    expect(artists.filter((a) => a === "Dua Lipa")).toHaveLength(2);
  });

  it("never offers a song that is in the playlist, even under a qualifier", () => {
    const tracks = [track("1", "Hello - Live", ["Adele"]), track("2", "Creep - Remastered", ["Radiohead"])];
    for (let seed = 0; seed < 20; seed += 1) {
      const decoys = pickDecoys({ name: "Hello - Live", artist: "Adele" }, ctxFor(tracks), seededRng(seed), THREE);
      expect(decoys.map((d) => d.title)).not.toContain("Hello");
      expect(decoys.map((d) => d.title)).not.toContain("Creep");
    }
  });

  it("stays in the same script when no playlist artist matches", () => {
    const tracks = [track("1", "說謊", ["林宥嘉"], 70)];
    const decoys = pickDecoys({ name: "說謊", artist: "林宥嘉", popularity: 70 }, ctxFor(tracks), seededRng(3), THREE);
    expect(decoys).toHaveLength(3);
    for (const d of decoys) expect(scriptBucket(d.artist, d.title)).toBe("zh");
  });

  it("prefers a similar popularity within the script before any popularity", () => {
    // Tier 3 is what keeps a deep-cut playlist from getting three chart-toppers
    // as the obvious odd ones out. No same-artist and no playlist-artist match,
    // so the window is the first tier that can fire.
    const pool: DecoyEntry[] = [
      { name: "Deep A", artist: "Nobody A", popularity: 30 },
      { name: "Deep B", artist: "Nobody B", popularity: 35 },
      { name: "Deep C", artist: "Nobody C", popularity: 25 },
      { name: "Hit D", artist: "Nobody D", popularity: 95 },
      { name: "Hit E", artist: "Nobody E", popularity: 90 },
      { name: "Hit F", artist: "Nobody F", popularity: 99 },
    ];
    const ctx = () => ({
      playlistTitles: new Set<string>(),
      playlistArtists: new Map<string, string>(),
      pool: bucketPool(pool),
      used: new Set<string>(),
    });
    for (let seed = 0; seed < 10; seed += 1) {
      const decoys = pickDecoys({ name: "Obscure", artist: "Someone", popularity: 30 }, ctx(), seededRng(seed), THREE);
      expect(decoys.map((d) => d.title).sort()).toEqual(["Deep A", "Deep B", "Deep C"]);
      for (const d of decoys) {
        const entry = pool.find((p) => p.name === d.title)!;
        expect(Math.abs(entry.popularity - 30)).toBeLessThanOrEqual(DECOY_POPULARITY_WINDOW);
      }
    }
    // Without a popularity on the target the window cannot be judged, and the
    // pick falls to "same script, any popularity" — still three, still valid.
    const blind = pickDecoys({ name: "Obscure", artist: "Someone" }, ctx(), seededRng(1), THREE);
    expect(blind).toHaveLength(3);
    // Nothing in the pool shares a script with a Korean target: tier 5 fills it anyway.
    const cross = pickDecoys({ name: "봄날", artist: "방탄소년단", popularity: 30 }, ctx(), seededRng(1), THREE);
    expect(cross).toHaveLength(3);
  });

  it("does not reuse a decoy across questions until the pool is dry", () => {
    const tracks = [track("1", "Let Down", ["Radiohead"], 74)];
    const ctx = ctxFor(tracks);
    const first = pickDecoys({ name: "Let Down", artist: "Radiohead", popularity: 74 }, ctx, seededRng(4), THREE);
    const second = pickDecoys({ name: "Let Down", artist: "Radiohead", popularity: 74 }, ctx, seededRng(5), THREE);
    const overlap = first.filter((a) => second.some((b) => b.title === a.title && b.artist === a.artist));
    expect(overlap).toHaveLength(0);
  });

  it("never repeats a decoy within one question, even when the pool has fewer than three", () => {
    const tiny: DecoyEntry[] = [
      { name: "A", artist: "X", popularity: 50 },
      { name: "B", artist: "X", popularity: 50 },
    ];
    const ctx = { playlistTitles: new Set<string>(), playlistArtists: new Map<string, string>(), pool: bucketPool(tiny), used: new Set<string>() };
    const decoys = pickDecoys({ name: "C", artist: "X" }, ctx, seededRng(6), THREE);
    expect(decoys).toHaveLength(2);
    expect(new Set(decoys.map((d) => d.title)).size).toBe(2);
  });

  it("reuses decoys spent on earlier questions once the pool is dry", () => {
    // The fallback `take(eligible)` is what keeps a late question at its full
    // option count after the fresh set runs out. Deleting it left the suite
    // green until this test existed.
    const three: DecoyEntry[] = [
      { name: "A", artist: "X", popularity: 50 },
      { name: "B", artist: "X", popularity: 50 },
      { name: "C", artist: "X", popularity: 50 },
    ];
    const ctx = { playlistTitles: new Set<string>(), playlistArtists: new Map<string, string>(), pool: bucketPool(three), used: new Set<string>() };
    expect(pickDecoys({ name: "Q1", artist: "X" }, ctx, seededRng(1), THREE)).toHaveLength(3);
    expect(ctx.used.size).toBe(3);
    expect(pickDecoys({ name: "Q2", artist: "X" }, ctx, seededRng(2), THREE)).toHaveLength(3);
  });
});

describe("pickDecoys with Spotify's romanised artists", () => {
  // Spotify credits 周杰倫 as "Jay Chou". The pool carries that as the
  // canonical name and the native spelling as an alias; a quiz built on the
  // native name matched nothing for the audience the pool was written for.
  const POOL_ALIASED: DecoyEntry[] = [
    { name: "晴天", artist: "Jay Chou", aliases: ["周杰倫"], popularity: 80 },
    { name: "七里香", artist: "Jay Chou", aliases: ["周杰倫"], popularity: 78 },
    { name: "稻香", artist: "Jay Chou", aliases: ["周杰倫"], popularity: 76 },
    { name: "溫柔", artist: "Mayday", aliases: ["五月天"], popularity: 74 },
    { name: "披星戴月的想你", artist: "告五人", aliases: ["Accusefive"], popularity: 75 },
    { name: "Hello", artist: "Adele", popularity: 78 },
  ];
  function ctxFor(tracks: Track[]) {
    return {
      playlistTitles: new Set(tracks.map((t) => displayTitle(t.name).toLowerCase())),
      playlistArtists: creditedArtists(tracks),
      pool: bucketPool(POOL_ALIASED),
      used: new Set<string>(),
    };
  }

  it("never offers the playlist's own song under a differently spelled artist", () => {
    const tracks = [track("1", "晴天", ["Jay Chou"], 80), track("2", "溫柔", ["Mayday"], 74)];
    for (let seed = 0; seed < 20; seed += 1) {
      const decoys = pickDecoys({ name: "晴天", artist: "Jay Chou", popularity: 80 }, ctxFor(tracks), seededRng(seed), 3);
      expect(decoys.map((d) => d.title)).not.toContain("晴天");
      expect(decoys.map((d) => d.title)).not.toContain("溫柔");
    }
  });

  it("matches the same-artist tier through the alias, and shows the artist in the playlist's script", () => {
    const tracks = [track("1", "Mojito", ["Jay Chou"], 70)];
    const decoys = pickDecoys({ name: "Mojito", artist: "Jay Chou", popularity: 70 }, ctxFor(tracks), seededRng(1), 3);
    expect(decoys).toHaveLength(3);
    // Three Jay Chou songs exist and none is in the playlist: the whole
    // question is his catalogue, credited the way the playlist credits him.
    expect(decoys.every((d) => d.artist === "Jay Chou")).toBe(true);
  });

  it("shows the native spelling when the playlist itself is credited natively", () => {
    const tracks = [track("1", "愛人錯過", ["告五人"], 74)];
    const decoys = pickDecoys({ name: "愛人錯過", artist: "告五人", popularity: 74 }, ctxFor(tracks), seededRng(2), 3);
    // No other 告五人 song in the pool, so the script tier serves Mandopop —
    // and 周杰倫, not "Jay Chou", so the real answer is not the odd one out.
    for (const d of decoys) expect(scriptBucket(d.artist)).toBe("zh");
    expect(decoys.map((d) => d.artist)).toContain("周杰倫");
  });

  it("displayArtist falls back to Spotify's name when no alias is in the wanted script", () => {
    expect(displayArtist({ name: "Hello", artist: "Adele", popularity: 78 }, "周杰倫")).toBe("Adele");
    expect(displayArtist({ name: "晴天", artist: "Jay Chou", aliases: ["周杰倫"], popularity: 80 }, "Mayday")).toBe("Jay Chou");
    expect(displayArtist({ name: "晴天", artist: "Jay Chou", aliases: ["周杰倫"], popularity: 80 }, "五月天")).toBe("周杰倫");
  });
});

describe("displayArtist follows the playlist's own credits", () => {
  // Observed live on a Mandopop playlist: Spotify credits most acts romanised
  // ("Ronghao Li", "JJ Lin") and a few natively (那英). Matching the real
  // option's script per question showed 李白 · 李榮浩 on the 那英 question and
  // 對等關係 · Ronghao Li on his own, so a taker who had seen "Ronghao Li"
  // once knew 李榮浩 was never the playlist's spelling.
  const RONGHAO: DecoyEntry = { name: "李白", artist: "Ronghao Li", aliases: ["李榮浩"], popularity: 68 };
  const JAY: DecoyEntry = { name: "晴天", artist: "Jay Chou", aliases: ["周杰倫"], popularity: 80 };
  const pool: DecoyEntry[] = [
    RONGHAO,
    { name: "模特", artist: "Ronghao Li", aliases: ["李榮浩"], popularity: 66 },
    JAY,
    { name: "Hello", artist: "Adele", popularity: 78 },
  ];
  const playlist = [track("1", "年少有為", ["Ronghao Li"], 72), track("2", "默", ["那英"], 70)];
  function ctxFor(tracks: Track[]) {
    return {
      playlistTitles: new Set(tracks.map((t) => displayTitle(t.name).toLowerCase())),
      playlistArtists: creditedArtists(tracks),
      pool: bucketPool(pool),
      used: new Set<string>(),
    };
  }

  it("creditedArtists keys every credit folded and keeps the first spelling seen", () => {
    const credited = creditedArtists([
      track("1", "A", ["Ronghao Li", "那英"]),
      track("2", "B", ["RONGHAO LI"]),
      { id: "3", name: "C", artists: ["", "  ", 42] } as unknown as Track,
      { id: "4", name: "D", artists: "not a list" } as unknown as Track,
    ]);
    expect([...credited]).toEqual([
      ["ronghao li", "Ronghao Li"],
      ["那英", "那英"],
    ]);
  });

  it("shows an act the playlist credits exactly as the playlist credits it, whatever the real option's script", () => {
    // The real option is 那英's, natively credited; the decoy is Ronghao Li's,
    // whom the playlist credits romanised. Second tier, so this is the shape
    // most questions on a mixed-script playlist take.
    for (let seed = 0; seed < 10; seed += 1) {
      const decoys = pickDecoys({ name: "默", artist: "那英", popularity: 70 }, ctxFor(playlist), seededRng(seed));
      expect(decoys).toHaveLength(1);
      expect(decoys[0].artist).toBe("Ronghao Li");
    }
    expect(displayArtist(RONGHAO, "那英", creditedArtists(playlist))).toBe("Ronghao Li");
    // Through the alias: a playlist that credits him natively gets that.
    expect(displayArtist(RONGHAO, "那英", creditedArtists([track("1", "年少有為", ["李榮浩"])]))).toBe("李榮浩");
    expect(displayArtist(RONGHAO, "Jay Chou", creditedArtists([track("1", "年少有為", ["李榮浩"])]))).toBe("李榮浩");
  });

  it("still follows the real option's script for an act the playlist never credits", () => {
    const credited = creditedArtists(playlist);
    expect(displayArtist(JAY, "那英", credited)).toBe("周杰倫");
    expect(displayArtist(JAY, "Ronghao Li", credited)).toBe("Jay Chou");
    expect(displayArtist({ name: "Hello", artist: "Adele", popularity: 78 }, "那英", credited)).toBe("Adele");
  });

  it("leaves the same-artist tier as it was: the real track's own credit, every time", () => {
    for (let seed = 0; seed < 10; seed += 1) {
      const decoys = pickDecoys(
        { name: "年少有為", artist: "Ronghao Li", popularity: 72 },
        ctxFor(playlist),
        seededRng(seed)
      );
      expect(decoys).toHaveLength(1);
      expect(decoys[0].artist).toBe("Ronghao Li");
      expect(["李白", "模特"]).toContain(decoys[0].title);
    }
  });

  it("buildQuiz never shows two spellings of one act across a quiz", () => {
    const tracks = [
      ...playlist,
      ...["李白 - Live", "麻雀", "不將就", "耳朵", "戒煙", "成長之重量", "王牌冤家", "作曲家"].map((name, i) =>
        track(String(i + 3), name, ["Ronghao Li"], 60)
      ),
    ];
    const quiz = buildQuiz({ tracks, questionCount: 10, pool, rng: seededRng(3) });
    expect(quiz).toHaveLength(10);
    const spellings = new Set(quiz.flatMap((q) => q.options.map((o) => o.artist)));
    expect(spellings.has("李榮浩")).toBe(false);
    expect(spellings.has("Ronghao Li")).toBe(true);
  });
});

describe("buildQuiz", () => {
  const playlist = [
    track("1", "Die For You", ["The Weeknd"], 80),
    track("2", "New Rules", ["Dua Lipa"], 76),
    track("3", "Let Down", ["Radiohead"], 74),
    track("4", "Come Together", ["The Beatles"], 78),
    track("5", "Rolling in the Deep", ["Adele"], 80),
    track("6", "Mojito", ["周杰倫"], 70),
    track("7", "突然好想你", ["五月天"], 75),
    track("8", "Levitating", ["Dua Lipa"], 82),
    track("9", "Karma Police", ["Radiohead"], 72),
    track("10", "Someone Like You", ["Adele"], 84),
    track("11", "Blinding Lights", ["The Weeknd"], 90),
    track("12", "小幸運", ["田馥甄"], 78),
  ];

  it("is deterministic under a seed, so every taker gets the same quiz", () => {
    const a = buildQuiz({ tracks: playlist, questionCount: 10, pool: POOL, rng: seededRng(42) });
    const b = buildQuiz({ tracks: playlist, questionCount: 10, pool: POOL, rng: seededRng(42) });
    expect(a).toEqual(b);
    const c = buildQuiz({ tracks: playlist, questionCount: 10, pool: POOL, rng: seededRng(43) });
    expect(c).not.toEqual(a);
  });

  it("builds two options per question with the real one at the recorded index", () => {
    const quiz = buildQuiz({ tracks: playlist, questionCount: 10, pool: POOL, rng: seededRng(7) });
    expect(quiz).toHaveLength(10);
    for (const q of quiz) {
      expect(q.options).toHaveLength(QUIZ_OPTION_COUNT);
      const real = q.options[q.answer];
      expect(songKey(real.title, real.artist)).toBe(songKey(q.track.name, q.track.artist));
      // The right answer's index is not always the same slot.
    }
    expect(new Set(quiz.map((q) => q.answer)).size).toBeGreaterThan(1);
  });

  it("asks about each song at most once, and clamps the count to the playlist", () => {
    const withDupes = [...playlist, track("13", "Die For You - Live", ["The Weeknd"], 80)];
    const quiz = buildQuiz({ tracks: withDupes, questionCount: 20, pool: POOL, rng: seededRng(8) });
    expect(quiz).toHaveLength(12);
    expect(new Set(quiz.map((q) => q.track.id)).size).toBe(12);
  });

  it("builds nothing below the minimum rather than a two-question quiz", () => {
    const quiz = buildQuiz({ tracks: playlist.slice(0, 9), questionCount: 10, pool: POOL, rng: seededRng(9) });
    expect(quiz).toEqual([]);
  });

  it("keeps the full Spotify title on the stored track and the clean one on the option", () => {
    const quiz = buildQuiz({
      // Slice past the plain "Karma Police" at id 9, or the remaster is deduped out.
      tracks: [...playlist.slice(0, 8), playlist[11], track("13", "Karma Police - Remastered 2011", ["Radiohead"], 78)],
      questionCount: 10,
      pool: POOL,
      rng: seededRng(10),
    });
    const q = quiz.find((x) => x.track.id === "13");
    expect(q?.track.name).toBe("Karma Police - Remastered 2011");
    expect(q?.options[q.answer].title).toBe("Karma Police");
  });

  it("survives the shapes parseGamePayload repairs", () => {
    const rough = [
      ...playlist.slice(0, 9),
      { ...track("13", "Untitled", []), durationMs: undefined } as unknown as Track,
      { id: "", name: "No id", artists: ["X"] } as unknown as Track,
      { id: "14", name: "   ", artists: ["X"] } as unknown as Track,
    ];
    const usable = usableQuizTracks(rough);
    expect(usable.map((t) => t.id)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "13"]);
    const quiz = buildQuiz({ tracks: rough, questionCount: 10, pool: POOL, rng: seededRng(11) });
    expect(quiz).toHaveLength(10);
    expect(quiz.find((q) => q.track.id === "13")?.track.durationMs).toBe(0);
  });

  it("strips the answer key and nothing else from the taker's view", () => {
    const quiz = buildQuiz({ tracks: playlist, questionCount: 10, pool: POOL, rng: seededRng(12) });
    const view = stripAnswerKey(quiz);
    expect(view).toHaveLength(10);
    for (const [i, q] of view.entries()) {
      expect(q).toEqual({ options: quiz[i].options });
      expect(JSON.stringify(q)).not.toContain("answer");
      expect(JSON.stringify(q)).not.toContain(quiz[i].track.id);
    }
  });
});

describe("clampQuestionCount", () => {
  it("bounds the request and then the playlist", () => {
    expect(clampQuestionCount(10, 100)).toBe(10);
    expect(clampQuestionCount(1000, 100)).toBe(QUIZ_MAX_QUESTIONS);
    expect(clampQuestionCount(1, 100)).toBe(QUIZ_MIN_QUESTIONS);
    expect(clampQuestionCount(15, 7)).toBe(7);
    expect(clampQuestionCount(Number.NaN, 100)).toBe(QUIZ_MIN_QUESTIONS);
  });

  it("truncates a fractional request and treats an infinite one as the minimum", () => {
    expect(clampQuestionCount(17.9, 100)).toBe(17);
    expect(clampQuestionCount(Number.POSITIVE_INFINITY, 100)).toBe(QUIZ_MIN_QUESTIONS);
    expect(clampQuestionCount(Number.NEGATIVE_INFINITY, 100)).toBe(QUIZ_MIN_QUESTIONS);
  });

  it("offers only presets the builder can honour, and defaults to one of them", () => {
    // The pill row on the setup page is QUIZ_QUESTION_COUNTS; a preset outside
    // [min, max] would be a button that silently builds a different quiz.
    expect(QUIZ_QUESTION_COUNTS).toContain(QUIZ_DEFAULT_QUESTION_COUNT);
    for (const c of QUIZ_QUESTION_COUNTS) {
      expect(clampQuestionCount(c, 500)).toBe(c);
      expect(hintAllowance(c)).toBeGreaterThanOrEqual(1);
      expect(hintAllowance(c)).toBeLessThan(c);
    }
    expect(Math.min(...QUIZ_QUESTION_COUNTS)).toBe(QUIZ_MIN_QUESTIONS);
    expect(Math.max(...QUIZ_QUESTION_COUNTS)).toBe(QUIZ_MAX_QUESTIONS);
  });
});

describe("usableQuizTracks", () => {
  it("skips holes and non-objects, and keeps a track whose artists field is not an array", () => {
    // A payload that has been through parseGamePayload can carry `artists: []`;
    // one that has not can carry anything. Neither may take the builder down.
    const rough = [
      null,
      undefined,
      "not a track",
      { id: "1", name: "A", artists: "The Weeknd" },
      { id: "2", name: "B", artists: undefined },
      { id: "3", name: "C", artists: [42] },
    ] as unknown as Track[];
    expect(usableQuizTracks(rough).map((t) => t.id)).toEqual(["1", "2", "3"]);
    const filler = ["D", "E", "F", "G", "H", "I", "J"].map((name, i) => ({ id: String(i + 4), name, artists: ["X"] }));
    const quiz = buildQuiz({
      tracks: [...rough, ...filler] as unknown as Track[],
      questionCount: 10,
      pool: POOL,
      rng: seededRng(20),
    });
    expect(quiz).toHaveLength(10);
    // The artist line is empty rather than "undefined" or "42".
    for (const q of quiz.filter((x) => ["1", "2", "3"].includes(x.track.id))) {
      expect(q.track.artist).toBe("");
      expect(q.options[q.answer].artist).toBe("");
    }
  });
});

describe("gradeAnswers", () => {
  const questions = buildQuiz({
    tracks: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"].map((name, i) => track(String(i + 1), name, ["X"])),
    questionCount: 10,
    pool: POOL,
    rng: seededRng(13),
  });

  it("grades against the stored key", () => {
    const key = questions.map((q) => q.answer);
    expect(gradeAnswers(questions, key)).toEqual({ correct: 10, total: 10, key, right: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] });
    const wrong = key.map((a) => (a + 1) % QUIZ_OPTION_COUNT);
    expect(gradeAnswers(questions, wrong)).toMatchObject({ correct: 0, right: [] });
    const half = key.map((a, i) => (i % 2 === 0 ? a : (a + 1) % QUIZ_OPTION_COUNT));
    expect(gradeAnswers(questions, half).right).toEqual([0, 2, 4, 6, 8]);
  });

  it("treats short, long, non-integer and out-of-range answers as wrong, not as a throw", () => {
    const key = questions.map((q) => q.answer);
    expect(gradeAnswers(questions, key.slice(0, 2)).correct).toBe(2);
    expect(gradeAnswers(questions, [...key, 0, 0, 0]).correct).toBe(10);
    expect(gradeAnswers(questions, key.map(() => 1.5)).correct).toBe(0);
    expect(gradeAnswers(questions, "nope").correct).toBe(0);
    expect(gradeAnswers(questions, null).total).toBe(10);
  });

  it("isAnswerList admits only a full list of option indexes", () => {
    // Two options, so 0 and 1 are the whole alphabet; a 2 was valid at four.
    expect(isAnswerList([0, 1, 1, 0, 1], 5)).toBe(true);
    expect(isAnswerList([0, 1, 1, 0], 5)).toBe(false);
    expect(isAnswerList([0, 1, QUIZ_OPTION_COUNT, 0, 1], 5)).toBe(false);
    expect(isAnswerList([0, 1, 1, 0, -1], 5)).toBe(false);
    expect(isAnswerList([0, 1, 1, 0, "0"], 5)).toBe(false);
    expect(isAnswerList("01101", 5)).toBe(false);
  });
});

describe("hints", () => {
  it("allows one hint per ten questions, never fewer than one", () => {
    expect(hintAllowance(10)).toBe(1);
    expect(hintAllowance(20)).toBe(2);
    expect(hintAllowance(30)).toBe(3);
    expect(hintAllowance(50)).toBe(5);
    expect(hintAllowance(1)).toBe(1);
    // Was one per five with four options; at two, a hint is a whole point.
    expect(hintAllowance(QUIZ_MAX_QUESTIONS) / QUIZ_MAX_QUESTIONS).toBeLessThanOrEqual(0.1);
  });

  it("clamps the client's count into what it could have used", () => {
    expect(clampHintsUsed(1, 10)).toBe(1);
    expect(clampHintsUsed(99, 10)).toBe(1);
    expect(clampHintsUsed(99, 20)).toBe(2);
    expect(clampHintsUsed(-3, 10)).toBe(0);
    expect(clampHintsUsed("2", 10)).toBe(0);
    expect(clampHintsUsed(undefined, 10)).toBe(0);
  });
});

describe("verdictFor", () => {
  it("buckets on the ratio, so every question count reads alike", () => {
    expect(verdictFor(10, 10)).toBe("soulmate");
    expect(verdictFor(9, 10)).toBe("soulmate");
    expect(verdictFor(8, 10)).toBe("close");
    expect(verdictFor(15, 20)).toBe("close");
    expect(verdictFor(6, 10)).toBe("acquaintance");
    expect(verdictFor(30, 50)).toBe("acquaintance");
    expect(verdictFor(5, 10)).toBe("stranger");
    expect(verdictFor(0, 0)).toBe("stranger");
    // The lowest passing bucket sits above chance for a two-option question,
    // so a coin flip reads as a stranger rather than as "getting there".
    expect(verdictFor(QUIZ_MAX_QUESTIONS / 2, QUIZ_MAX_QUESTIONS)).toBe("stranger");
  });

  it("isQuizVerdict admits exactly the declared buckets, since the value becomes a KV key", () => {
    for (const v of QUIZ_VERDICTS) expect(isQuizVerdict(v)).toBe(true);
    for (const bad of ["83.7%", "Soulmate", "", null, undefined, 1, ["close"], { verdict: "close" }]) {
      expect(isQuizVerdict(bad), String(bad)).toBe(false);
    }
  });

  it("has a label for every verdict in both languages, and they differ", () => {
    for (const v of QUIZ_VERDICTS) {
      expect(QUIZ_COPY.en.verdicts[v]).toBeTruthy();
      expect(QUIZ_COPY.zh.verdicts[v]).toBeTruthy();
      expect(QUIZ_COPY.en.verdicts[v]).not.toBe(QUIZ_COPY.zh.verdicts[v]);
    }
  });
});

describe("the board", () => {
  const entries: QuizScore[] = [
    { name: "bo", correct: 7, total: 10, hintsUsed: 2, at: 3 },
    { name: "Al", correct: 9, total: 10, hintsUsed: 1, at: 2 },
    { name: "cy", correct: 9, total: 10, hintsUsed: 0, at: 5 },
    { name: "di", correct: 9, total: 10, hintsUsed: 0, at: 4 },
  ];

  it("sorts by score, then fewer hints, then who got there first", () => {
    expect(sortScoreboard(entries).map((e) => e.name)).toEqual(["di", "cy", "Al", "bo"]);
  });

  it("falls back to the name when score, hints and time all tie, so the order is total", () => {
    // Without a last tiebreak two rows that agree on everything else would sort
    // by whatever order the hash returned them in, and the board would reshuffle
    // between two reads.
    const tied: QuizScore[] = [
      { name: "zed", correct: 5, total: 5, hintsUsed: 0, at: 1 },
      { name: "Amy", correct: 5, total: 5, hintsUsed: 0, at: 1 },
      { name: "小明", correct: 5, total: 5, hintsUsed: 0, at: 1 },
    ];
    const once = sortScoreboard(tied).map((e) => e.name);
    const again = sortScoreboard([...tied].reverse()).map((e) => e.name);
    expect(once).toEqual(again);
    expect(once.indexOf("Amy")).toBeLessThan(once.indexOf("zed"));
  });

  it("does not mutate the input, since hash fields arrive in no order", () => {
    const copy = [...entries];
    sortScoreboard(entries);
    expect(entries).toEqual(copy);
  });

  it("summarises takers, the mean, and per-question rates from rows that carry them", () => {
    const rows: QuizScore[] = [
      { name: "a", correct: 3, total: 3, hintsUsed: 0, at: 1, right: [0, 1, 2] },
      { name: "b", correct: 1, total: 3, hintsUsed: 0, at: 2, right: [1] },
      { name: "legacy", correct: 2, total: 3, hintsUsed: 0, at: 3 },
      { name: "odd", correct: 1, total: 3, hintsUsed: 0, at: 4, right: [7, -1, 1.5, 2] },
    ];
    const summary = summarizeBoard(rows, 3);
    expect(summary.takers).toBe(4);
    expect(summary.averageCorrect).toBeCloseTo(7 / 4);
    // The legacy row has no per-question data, so it is not in `answered`.
    expect(summary.perQuestion).toEqual([
      { answered: 3, correct: 1 },
      { answered: 3, correct: 2 },
      { answered: 3, correct: 2 },
    ]);
    expect(summarizeBoard([], 3)).toEqual({
      takers: 0,
      averageCorrect: null,
      perQuestion: [{ answered: 0, correct: 0 }, { answered: 0, correct: 0 }, { answered: 0, correct: 0 }],
    });
  });

  it("ranks by folded name and reports absence as null", () => {
    const sorted = sortScoreboard(entries);
    expect(rankOf(sorted, "al")).toBe(3);
    expect(rankOf(sorted, "DI")).toBe(1);
    expect(rankOf(sorted, "nobody")).toBeNull();
  });

  describe("pickBoardTiles", () => {
    const q = (answered: number, correct: number) => ({ answered, correct });

    it("crowns only a unanimous question: 100% for everyone knew, 0% for nobody could place", () => {
      expect(pickBoardTiles([q(3, 2), q(3, 3), q(3, 0), q(3, 1)])).toEqual({ easiest: 1, hardest: 2 });
      // Each is independent: a board with no zero has one tile, not a
      // "nobody could place" awarded to whichever question scored lowest.
      expect(pickBoardTiles([q(3, 2), q(3, 3), q(3, 1)])).toEqual({ easiest: 1 });
      expect(pickBoardTiles([q(3, 2), q(3, 0), q(3, 1)])).toEqual({ hardest: 1 });
    });

    it("gives a 50/50 board no tile at all", () => {
      // Two takers on opposite sheets: every question is 1 of 2. The page
      // used to label the first of them "Everyone knew · 1 of 2 got it".
      expect(pickBoardTiles([q(2, 1), q(2, 1), q(2, 1)])).toEqual({});
    });

    it("needs at least two takers before either label means anything", () => {
      expect(BOARD_TILE_MIN_ANSWERED).toBe(2);
      // One taker: every question is 100% or 0%, and both labels are true of
      // half the board. Neither is a finding.
      expect(pickBoardTiles([q(1, 1), q(1, 0), q(1, 1)])).toEqual({});
      // Nobody has recorded per-question results yet (legacy rows only).
      expect(pickBoardTiles([q(0, 0), q(0, 0)])).toEqual({});
      expect(pickBoardTiles([])).toEqual({});
      // A second taker makes it real, and a question only one of them answered
      // — none can, today, but the rule is per question — stays out.
      expect(pickBoardTiles([q(1, 1), q(2, 2), q(2, 0)])).toEqual({ easiest: 1, hardest: 2 });
    });

    it("keeps the first question on a tie, so the tile is stable between reads", () => {
      expect(pickBoardTiles([q(4, 4), q(4, 4), q(4, 0), q(4, 0)])).toEqual({ easiest: 0, hardest: 2 });
    });
  });
});

describe("seededRng", () => {
  it("is reproducible and stays in [0, 1)", () => {
    const a = seededRng(99);
    const b = seededRng(99);
    for (let i = 0; i < 1000; i += 1) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe("QUIZ_COPY", () => {
  const keys = Object.keys(QUIZ_COPY.en) as Array<keyof typeof QUIZ_COPY.en>;
  const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

  it("carries the same placeholders in both languages, for every string", () => {
    for (const key of keys) {
      const en = QUIZ_COPY.en[key];
      const zh = QUIZ_COPY.zh[key];
      if (typeof en === "string" && typeof zh === "string") {
        expect(placeholders(zh), key).toEqual(placeholders(en));
        // A string that is only numbers and punctuation has nothing to translate.
        if (/[A-Za-z]/.test(en.replace(/\{\w+\}/g, ""))) expect(zh, key).not.toBe(en);
      }
    }
  });

  it("keeps the Chinese half free of English words", () => {
    for (const key of keys) {
      const zh = QUIZ_COPY.zh[key];
      if (typeof zh === "string") {
        expect(zh.replace(/\{\w+\}/g, ""), key).not.toMatch(/[A-Za-z]{2,}/);
      }
    }
    for (const label of Object.values(QUIZ_COPY.zh.verdicts)) {
      expect(label).not.toMatch(/[A-Za-z]/);
    }
  });

  it("pluralises the English hint word and leaves the Chinese measure word alone", () => {
    expect(hintWord("en", 1)).toBe("hint");
    expect(hintWord("en", 0)).toBe("hints");
    expect(hintWord("en", 4)).toBe("hints");
    expect(hintWord("zh", 1)).toBe(hintWord("zh", 4));
    expect(fillCopy(QUIZ_COPY.en.hintsUsedLine, { hints: 2, hintWord: hintWord("en", 2) })).toBe("2 hints used");
  });

  it("fills placeholders and leaves unknown ones visible", () => {
    expect(fillCopy("{n} of {total}", { n: 2, total: 5 })).toBe("2 of 5");
    expect(fillCopy("{n} of {total}", { n: 2 })).toBe("2 of {total}");
    expect(fillCopy(QUIZ_COPY.en.introBody, { count: 10, hints: 1, hintWord: hintWord("en", 1) })).toContain("1 hint to");
    expect(fillCopy(QUIZ_COPY.zh.hintsUsedLine, { hints: 2, hintWord: hintWord("zh", 2) })).toBe("用了 2 次提示");
  });
});

describe("QUIZ_DECOY_POOL", () => {
  const bucketed = bucketPool(QUIZ_DECOY_POOL);

  it("has no duplicate songs and no empty fields", () => {
    const keys = bucketed.map((d) => `${d.titleKey}|${d.artist}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of QUIZ_DECOY_POOL) {
      expect(d.name.trim()).toBeTruthy();
      expect(d.artist.trim()).toBeTruthy();
      expect(d.popularity).toBeGreaterThanOrEqual(0);
      expect(d.popularity).toBeLessThanOrEqual(100);
      for (const a of d.aliases ?? []) expect(a.trim()).toBeTruthy();
    }
  });

  it("credits every act the way Spotify does: a Latin canonical name unless Spotify keeps it native", () => {
    // Spotify romanises nearly every CJK act ("Jay Chou", "Mayday", "Kenshi
    // Yonezu"); a pool keyed on the native name matched nothing. The native
    // spelling belongs in `aliases`, where the tiers still match it and
    // `displayArtist` can show it to a natively credited playlist.
    const nativeOnSpotify = new Set(["告五人", "吳青峰", "理想混蛋", "信樂團"]);
    for (const d of QUIZ_DECOY_POOL) {
      if (nativeOnSpotify.has(d.artist)) continue;
      expect(scriptBucket(d.artist), `${d.name} — ${d.artist}`).toBe("latin");
    }
    // And the acts that do have a native spelling carry it as an alias.
    const jay = QUIZ_DECOY_POOL.find((d) => d.artist === "Jay Chou");
    expect(jay?.aliases).toContain("周杰倫");
  });

  it("is deep enough in every script to fill a twenty-question quiz without repeats", () => {
    const need = QUIZ_MAX_QUESTIONS * (QUIZ_OPTION_COUNT - 1);
    for (const script of ["latin", "zh", "ja", "ko"] as const) {
      const size = bucketed.filter((d) => d.script === script).length;
      // latin and zh are where the site's hosts are and must stand on their
      // own. ja leans on the same-artist tier and cross-script fallbacks. ko is
      // small by construction: Spotify titles most K-pop in Latin script, so
      // those entries bucket as `latin` on both sides — the same-artist tier is
      // what serves a K-pop playlist, not this bucket.
      const floor = { latin: need, zh: need, ja: 30, ko: 10 }[script];
      expect(size, script).toBeGreaterThanOrEqual(floor);
    }
  });

  it("gives most artists at least two songs, so the same-artist tier usually fires", () => {
    const perArtist = new Map<string, number>();
    for (const d of bucketed) perArtist.set(d.artist, (perArtist.get(d.artist) ?? 0) + 1);
    const singles = [...perArtist.values()].filter((n) => n < 2).length;
    expect(singles / perArtist.size).toBeLessThan(0.1);
  });
});
