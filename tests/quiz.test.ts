import { describe, it, expect } from "vitest";
import {
  buildQuiz,
  bucketPool,
  clampHintsUsed,
  clampQuestionCount,
  creditedArtists,
  displayArtist,
  displayDecoyTitle,
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
  titleKey,
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

  it("strips a full-width qualifier, and one whose brackets do not match", () => {
    // Both seen on Spotify (2026-09-15): a mainland release closes with ）,
    // and one Taiwanese release opens with ( and closes with ）.
    expect(displayTitle("光亮（大型紀錄片《紫禁城》主題歌）")).toBe("光亮");
    expect(displayTitle("路過人間 (電視劇《我們與惡的距離》插曲）")).toBe("路過人間");
    expect(displayTitle("不將就 (電影\"何以笙簫默\"片尾曲)")).toBe("不將就");
    expect(displayTitle("演员【Live】")).toBe("演员");
    expect(displayTitle("Everybody's Changing – Live At Airwaves Festival")).toBe("Everybody's Changing");
    expect(displayTitle("歌 － Live")).toBe("歌");
  });

  it("strips a dashed tail that carries a line terminator, and stays fast doing it", () => {
    // `.*` could not cross the newline, so this title kept its tail and the
    // engine retried every split of both whitespace runs before giving up:
    // cubic, 1.2s at 3,000 characters. `[\s\S]*` makes the tail unconditional.
    // The newline has to survive `name.trim()` — a character after it — or
    // the regex never sees it and the old code answers in 0.09ms.
    expect(displayTitle("Song - Live\nat Wembley")).toBe("Song");
    const pathological = "x" + " ".repeat(1500) + "-" + " ".repeat(1500) + "y\nz";
    const started = performance.now();
    expect(displayTitle(pathological)).toBe("x");
    expect(performance.now() - started).toBeLessThan(200);
  });

  it("strips every dash in the class, and a full-width square bracket", () => {
    // Six dashes: hyphen, en, em, full-width hyphen, U+2010, U+2011. ［…］ is
    // the third full-width opener.
    for (const dash of ["-", "–", "—", "－", "\u2010", "\u2011"]) {
      expect(displayTitle(`Song ${dash} Live`), JSON.stringify(dash)).toBe("Song");
    }
    expect(displayTitle("演員［Live］")).toBe("演員");
    // A dash with no space on one side is still part of the title.
    expect(displayTitle("Song —Live")).toBe("Song —Live");
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

describe("titleKey", () => {
  // Every pair here is one song Spotify lists both ways, or lists one way
  // where the pool had the other (search API, 2026-09-15). Before the fold,
  // each was a decoy that could be in the playlist and still be offered as
  // the wrong answer.
  it("folds Traditional and Simplified onto one key", () => {
    expect(titleKey("演员")).toBe(titleKey("演員"));
    expect(titleKey("丑八怪")).toBe(titleKey("醜八怪"));
    expect(titleKey("像我这样的人")).toBe(titleKey("像我這樣的人"));
    expect(titleKey("化身孤岛的鲸")).toBe(titleKey("化身孤島的鯨"));
    expect(titleKey("年少有为")).toBe(titleKey("年少有為"));
    expect(titleKey("大鱼")).toBe(titleKey("大魚 - 唱片版"));
    // The character the raw table chained through: 麼 → 么 → 幺. Both
    // spellings of the most common word in the language must key alike.
    expect(titleKey("怎么了")).toBe(titleKey("怎麼了"));
    expect(titleKey("为什么")).toBe(titleKey("為什麼"));
    expect(titleKey(titleKey("怎麼了"))).toBe(titleKey("怎麼了"));
  });

  it("folds spacing, punctuation, case and width", () => {
    expect(titleKey("Play我呸")).toBe(titleKey("Play 我呸"));
    expect(titleKey("踩.腳.踏.車")).toBe(titleKey("踩...腳踏車"));
    expect(titleKey("God’s Menu")).toBe(titleKey("God's Menu"));
    expect(titleKey("you’re the one I love")).toBe(titleKey("you're the one i love"));
    expect(titleKey("Ｐｌａｙ我呸")).toBe(titleKey("Play我呸"));
    expect(titleKey("光亮（大型紀錄片《紫禁城》主題歌）")).toBe(titleKey("光亮"));
  });

  it("still tells different songs apart, and never keys a title to nothing", () => {
    expect(titleKey("晴天")).not.toBe(titleKey("七里香"));
    expect(titleKey("Hello")).not.toBe(titleKey("Halo"));
    expect(titleKey("成全")).toBe("成全");
    // All punctuation: the folded title itself rather than the empty string,
    // so two such titles do not collide on "".
    expect(titleKey("...")).toBe("...");
    expect(titleKey("K.")).toBe("k");
    expect(titleKey("...")).not.toBe(titleKey("!!!"));
    // displayTitle keeps "(Intro)" whole; the key still drops its brackets,
    // so a playlist "(Intro)" excludes a pool "Intro".
    expect(titleKey("(Intro)")).toBe("intro");
  });

  it("keys a blank title to the empty string rather than throwing", () => {
    // usableQuizTracks drops a track with no name and the pool test refuses
    // an empty entry, so nothing in production asks this; the contract is
    // that the fold never throws and a blank stays blank.
    expect(titleKey("")).toBe("");
    expect(titleKey("   ")).toBe("");
    expect(titleKey("\u3000")).toBe("");
  });

  it("folds a compatibility ideograph through NFKC before the table, and drops symbols outside the BMP", () => {
    // U+F900 is the compatibility form of 豈; NFKC takes it to U+8C48 and the
    // table takes that to 岂. The noise class runs with the `u` flag, so an
    // emoji is one symbol and not two halves of a surrogate pair.
    expect(titleKey("\uF900")).toBe(titleKey("岂"));
    expect(titleKey("豈")).toBe(titleKey("岂"));
    expect(titleKey("Hello 🎵")).toBe("hello");
    expect(titleKey("🎵")).toBe("🎵");
  });
});

describe("songKey and foldQuizName", () => {
  it("keys the same recording under one key regardless of case, spacing and qualifiers", () => {
    expect(songKey("Hello - Live", "Adele")).toBe(songKey("hello", "ADELE "));
    expect(songKey("Hello", "Adele")).not.toBe(songKey("Hello", "Lionel Richie"));
    expect(songKey("演员", "Joker Xue")).toBe(songKey("演員", "Joker Xue"));
    // The artist half folds the same way: one act credited in two scripts is
    // still one act.
    expect(songKey("演员", "薛之谦")).toBe(songKey("演員", "薛之謙"));
    expect(songKey("Hello", "ＡＤＥＬＥ")).toBe(songKey("Hello", "Adele"));
  });

  it("folds names the way the room roster does, and never folds script", () => {
    expect(foldQuizName("  Alice ")).toBe("alice");
    // The store's `s:<name>` hash field and lib/room.ts's fold both derive
    // from this: a Traditional and a Simplified name are two takers, as they
    // are two players. `foldText`, the artist-credit key beside it in
    // lib/quiz.ts, folds script; this must not.
    expect(foldQuizName("陳")).toBe("陳");
    expect(foldQuizName("陳")).not.toBe(foldQuizName("陈"));
  });
});

describe("pickDecoys", () => {
  function ctxFor(tracks: Track[]) {
    const playlistTitles = new Set(tracks.map((t) => titleKey(t.name)));
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

  it("never offers a song that is in the playlist under the spelling Spotify uses", () => {
    // The reported bug: a Joker Xue playlist carries his catalogue as
    // Spotify lists it, in Simplified, and the pool had it in Traditional.
    // The same-artist tier then served 演員 as "not in the playlist" to a
    // friend who could see 演员 was, and — the target's own key not folding
    // either — could serve 剛剛好 as the wrong answer to 刚刚好.
    const pool: DecoyEntry[] = [
      { name: "演員", artist: "Joker Xue", aliases: ["薛之謙"], popularity: 72 },
      { name: "醜八怪", artist: "Joker Xue", aliases: ["薛之謙"], popularity: 68 },
      { name: "剛剛好", artist: "Joker Xue", aliases: ["薛之謙"], popularity: 67 },
      { name: "紳士", artist: "Joker Xue", aliases: ["薛之謙"], popularity: 64 },
      { name: "光亮", artist: "Zhou Shen", aliases: ["周深"], popularity: 62 },
      { name: "Spring Day", artist: "BTS", aka: ["봄날"], popularity: 72 },
      { name: "Dynamite", artist: "BTS", popularity: 82 },
      { name: "晴天", artist: "Jay Chou", aliases: ["周杰倫"], popularity: 80 },
    ];
    const tracks = [
      track("1", "演员", ["Joker Xue"], 72),
      track("2", "丑八怪", ["Joker Xue"], 68),
      track("3", "刚刚好", ["Joker Xue"], 67),
      track("4", "光亮（大型紀錄片《紫禁城》主題歌）", ["Zhou Shen"], 62),
      track("5", "봄날", ["BTS"], 72),
    ];
    const ctx = () => ({
      playlistTitles: new Set(tracks.map((t) => titleKey(t.name))),
      playlistArtists: creditedArtists(tracks),
      pool: bucketPool(pool),
      used: new Set<string>(),
    });
    for (let seed = 0; seed < 20; seed += 1) {
      const decoys = pickDecoys({ name: "刚刚好", artist: "Joker Xue", popularity: 67 }, ctx(), seededRng(seed), THREE);
      const titles = decoys.map((d) => d.title);
      // 紳士 is the only Joker Xue song not in the playlist; the rest fall
      // through to the script tier, never to a playlist song.
      expect(titles).toContain("紳士");
      for (const t of ["演員", "醜八怪", "剛剛好", "光亮"]) expect(titles).not.toContain(t);
      // Through the aka: "Spring Day" is 봄날, which is in the playlist.
      const bts = pickDecoys({ name: "봄날", artist: "BTS", popularity: 72 }, ctx(), seededRng(seed), THREE);
      expect(bts.map((d) => d.title)).not.toContain("Spring Day");
      expect(bts.map((d) => d.title)).not.toContain("봄날");
    }
  });

  it("shows a decoy's title in the real option's script, through its aka", () => {
    const spring: DecoyEntry = { name: "Spring Day", artist: "BTS", aka: ["봄날"], popularity: 72 };
    expect(displayDecoyTitle(spring, "Dynamite")).toBe("Spring Day");
    expect(displayDecoyTitle(spring, "예뻤어")).toBe("봄날");
    // No title in the wanted script: Spotify's.
    expect(displayDecoyTitle(spring, "晴天")).toBe("Spring Day");
    expect(displayDecoyTitle({ name: "晴天", artist: "Jay Chou", popularity: 80 }, "Dynamite")).toBe("晴天");
    // The script is the shown title's: a Hangul guest credit in the qualifier
    // must not put 봄날 beside "Dynamite".
    expect(displayDecoyTitle(spring, "Dynamite (feat. 지민)")).toBe("Spring Day");
    // And the picker uses it: a Hangul real option gets the Hangul title.
    const pool = bucketPool([spring, { name: "Dynamite", artist: "BTS", popularity: 82 }]);
    const ctx = { playlistTitles: new Set<string>(), playlistArtists: new Map<string, string>(), pool, used: new Set<string>() };
    const decoys = pickDecoys({ name: "예뻤어", artist: "BTS", popularity: 70 }, ctx, seededRng(1), 2);
    expect(decoys.map((d) => d.title).sort()).toEqual(["Dynamite", "봄날"]);
    // The aka also puts the entry in the Hangul bucket for the script tiers.
    expect(pool[0].scripts.has("ko")).toBe(true);
    expect(pool[0].scripts.has("latin")).toBe(true);
    expect(scriptBucket(pool[0].name)).toBe("latin");
  });

  it("buckets an empty aka like no aka, and one aka that keys like the name as one key", () => {
    const [plain, empty, same, other] = bucketPool([
      { name: "Spring Day", artist: "BTS", popularity: 72 },
      { name: "Spring Day", artist: "BTS", aka: [], popularity: 72 },
      { name: "Spring Day", artist: "BTS", aka: ["Spring day"], popularity: 72 },
      { name: "Spring Day", artist: "BTS", aka: ["봄날"], popularity: 72 },
    ]);
    for (const d of [plain, empty, same]) {
      expect([...d.titleKeys]).toEqual(["springday"]);
      expect([...d.scripts]).toEqual(["latin"]);
      expect(d.titleKey).toBe("springday");
    }
    expect([...other.titleKeys]).toEqual(["springday", "봄날"]);
    expect([...other.scripts]).toEqual(["latin", "ko"]);
    // The primary title stays the identity whatever the aka adds.
    expect(other.titleKey).toBe("springday");
  });

  it("shows the first aka in the real option's script, and Spotify's title when the aka is empty", () => {
    const two: DecoyEntry = { name: "Spring Day", artist: "BTS", aka: ["春日", "봄날"], popularity: 72 };
    expect(displayDecoyTitle(two, "예뻤어")).toBe("봄날");
    expect(displayDecoyTitle(two, "晴天")).toBe("春日");
    expect(displayDecoyTitle(two, "Dynamite")).toBe("Spring Day");
    const none: DecoyEntry = { name: "Spring Day", artist: "BTS", aka: [], popularity: 72 };
    expect(displayDecoyTitle(none, "예뻤어")).toBe("Spring Day");
    // The real option's script is read from its title alone: a Latin title
    // by a Mandopop act wants a Latin decoy title, and gets Spotify's when
    // the decoy has none.
    expect(displayDecoyTitle({ name: "晴天", artist: "Jay Chou", aliases: ["周杰倫"], popularity: 80 }, "Mojito")).toBe("晴天");
  });

  it("reaches an entry through its aka's script when no artist tier matches", () => {
    // Before `scripts`, a K-pop entry bucketed as `latin` from its English
    // name alone, so a Hangul real option by an act the pool does not know
    // fell to tier 3/4 among Latin titles and never saw 봄날. With the
    // popularity in range this is tier 3; without one it is tier 4; both
    // must read the aka's bucket, and show the aka.
    const pool: DecoyEntry[] = [
      { name: "Spring Day", artist: "BTS", aka: ["봄날"], popularity: 72 },
      { name: "Levitating", artist: "Dua Lipa", popularity: 70 },
      { name: "Physical", artist: "Dua Lipa", popularity: 71 },
      { name: "Creep", artist: "Radiohead", popularity: 69 },
    ];
    const ctx = () => ({
      playlistTitles: new Set<string>(),
      playlistArtists: new Map<string, string>(),
      pool: bucketPool(pool),
      used: new Set<string>(),
    });
    for (let seed = 0; seed < 10; seed += 1) {
      const near = pickDecoys({ name: "예뻤어", artist: "DAY6", popularity: 70 }, ctx(), seededRng(seed), 1);
      expect(near.map((d) => d.title)).toEqual(["봄날"]);
      const any = pickDecoys({ name: "예뻤어", artist: "DAY6" }, ctx(), seededRng(seed), 1);
      expect(any.map((d) => d.title)).toEqual(["봄날"]);
    }
  });

  it("spends an entry once, whichever of its titles it showed", () => {
    // `used` is keyed on the primary titleKey, so 봄날 on one question is
    // "Spring Day" spent on the next: a taker must not meet the same decoy
    // twice under two spellings.
    const pool: DecoyEntry[] = [
      { name: "Spring Day", artist: "BTS", aka: ["봄날"], popularity: 72 },
      { name: "Levitating", artist: "Dua Lipa", popularity: 70 },
      { name: "Physical", artist: "Dua Lipa", popularity: 71 },
      { name: "Creep", artist: "Radiohead", popularity: 69 },
    ];
    for (let seed = 0; seed < 10; seed += 1) {
      const ctx = {
        playlistTitles: new Set<string>(),
        playlistArtists: new Map<string, string>(),
        pool: bucketPool(pool),
        used: new Set<string>(),
      };
      const first = pickDecoys({ name: "예뻤어", artist: "DAY6", popularity: 70 }, ctx, seededRng(seed), 1);
      expect(first.map((d) => d.title)).toEqual(["봄날"]);
      const second = pickDecoys({ name: "Dynamite", artist: "DAY6", popularity: 70 }, ctx, seededRng(seed + 100), 1);
      expect(second.map((d) => d.title)).not.toContain("Spring Day");
      expect(second.map((d) => d.title)).not.toContain("봄날");
      expect(second).toHaveLength(1);
    }
  });

  it("excludes an entry whose aka is the real song, with nothing else in the playlist", () => {
    // The eligibility check reads every key of an entry against the target's
    // own key, not only the playlist set: a caller with an empty playlist
    // set and a Hangul target must still never be offered its own song.
    const pool: DecoyEntry[] = [
      { name: "Spring Day", artist: "BTS", aka: ["봄날"], popularity: 72 },
      { name: "Levitating", artist: "Dua Lipa", popularity: 70 },
      { name: "Physical", artist: "Dua Lipa", popularity: 71 },
    ];
    const ctx = () => ({
      playlistTitles: new Set<string>(),
      playlistArtists: new Map<string, string>(),
      pool: bucketPool(pool),
      used: new Set<string>(),
    });
    for (let seed = 0; seed < 10; seed += 1) {
      const titles = pickDecoys({ name: "봄날", artist: "DAY6", popularity: 70 }, ctx(), seededRng(seed), THREE).map((d) => d.title);
      expect(titles).not.toContain("Spring Day");
      expect(titles).not.toContain("봄날");
      expect(titles).toHaveLength(2);
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
      playlistTitles: new Set(tracks.map((t) => titleKey(t.name))),
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
      playlistTitles: new Set(tracks.map((t) => titleKey(t.name))),
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

  it("creditedArtists keys one act credited in two scripts once, first spelling first", () => {
    // Two Spotify artist ids, one act: the Simplified release and the
    // Traditional one. One key, so the same-artist tier reaches both, and the
    // playlist's first spelling is what a decoy by that act is credited as.
    const a = creditedArtists([track("1", "A", ["周興哲"]), track("2", "B", ["周兴哲"])]);
    expect([...a]).toEqual([["周兴哲", "周興哲"]]);
    const b = creditedArtists([track("1", "A", ["周兴哲"]), track("2", "B", ["周興哲"])]);
    expect([...b]).toEqual([["周兴哲", "周兴哲"]]);
    const eric: DecoyEntry = { name: "怎麼了", artist: "Eric Chou", aliases: ["周興哲"], popularity: 71 };
    expect(displayArtist(eric, "Jay Chou", a)).toBe("周興哲");
    expect(displayArtist(eric, "Jay Chou", b)).toBe("周兴哲");
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

  it("never puts a playlist song on the wrong side of a question, under any spelling Spotify uses", () => {
    // End to end against the production pool, with the titles Spotify
    // actually returned for these tracks on 2026-09-15. Every one of these
    // is a pool song; before `titleKey` folded scripts, brackets and
    // translations, the same-artist tier served most of them back as "not in
    // the playlist".
    const tracks = [
      track("1", "演员", ["Joker Xue"], 72),
      track("2", "丑八怪", ["Joker Xue"], 68),
      track("3", "刚刚好", ["Joker Xue"], 67),
      track("4", "绅士", ["Joker Xue"], 64),
      track("5", "像我这样的人", ["Mao Buyi"], 68),
      track("6", "化身孤岛的鲸", ["Zhou Shen"], 60),
      track("7", "光亮（大型紀錄片《紫禁城》主題歌）", ["Zhou Shen"], 62),
      track("8", "年少有为", ["Ronghao Li"], 72),
      track("9", "Spring Day", ["BTS"], 72),
      track("10", "Good day", ["IU"], 70),
      track("11", "Through the Night", ["IU"], 72),
      track("12", "Red Flavor", ["Red Velvet"], 66),
      track("13", "Play我呸", ["JOLIN"], 62),
      track("14", "God’s Menu", ["Stray Kids"], 74),
    ];
    const inPlaylist = new Set(tracks.map((t) => titleKey(t.name)));
    for (let seed = 0; seed < 10; seed += 1) {
      const quiz = buildQuiz({ tracks, questionCount: 14, pool: QUIZ_DECOY_POOL, rng: seededRng(seed) });
      expect(quiz).toHaveLength(14);
      for (const q of quiz) {
        for (const [i, option] of q.options.entries()) {
          if (i === q.answer) continue;
          expect(inPlaylist.has(titleKey(option.title)), `${option.title} · ${option.artist} (seed ${seed})`).toBe(false);
        }
      }
    }
  });

  it("shows the real option without its full-width qualifier and keeps Spotify's title on the stored track", () => {
    // The hint route picks a recording by the full title; the option must
    // not carry the qualifier, or 光亮（大型紀錄片《紫禁城》主題歌） beside a
    // plain decoy is the answer by its length.
    const tracks = [
      ...playlist.slice(0, 9),
      track("13", "光亮（大型紀錄片《紫禁城》主題歌）", ["Zhou Shen"], 62),
      track("14", "路過人間 (電視劇《我們與惡的距離》插曲）", ["Yisa Yu"], 62),
    ];
    const quiz = buildQuiz({ tracks, questionCount: 11, pool: QUIZ_DECOY_POOL, rng: seededRng(13) });
    const light = quiz.find((q) => q.track.id === "13");
    expect(light?.track.name).toBe("光亮（大型紀錄片《紫禁城》主題歌）");
    expect(light?.options[light.answer].title).toBe("光亮");
    const passing = quiz.find((q) => q.track.id === "14");
    expect(passing?.track.name).toBe("路過人間 (電視劇《我們與惡的距離》插曲）");
    expect(passing?.options[passing.answer].title).toBe("路過人間");
    // Both are pool songs; neither may be the decoy for the other or itself.
    for (const q of [light, passing]) {
      for (const [i, option] of (q?.options ?? []).entries()) {
        if (i === q?.answer) continue;
        expect(["光亮", "路過人間"]).not.toContain(option.title);
      }
    }
  });

  it("excludes the pool's 怎麼了 for a Simplified 怎么了, and reaches the same-artist tier through a Simplified credit", () => {
    // 怎麼了 (Eric Chou) is in the production pool. A Simplified release
    // spells it 怎么了 and credits 周兴哲; before the table was closed the
    // first keyed differently, and before the artist fold the second never
    // matched the pool's 周興哲 alias.
    const tracks = [
      track("1", "怎么了", ["周兴哲"], 71),
      track("2", "你，好不好？", ["周兴哲"], 73),
      track("3", "晴天", ["Jay Chou"], 80),
    ];
    const ctx = () => ({
      playlistTitles: new Set(tracks.map((t) => titleKey(t.name))),
      playlistArtists: creditedArtists(tracks),
      pool: bucketPool(QUIZ_DECOY_POOL),
      used: new Set<string>(),
    });
    for (let seed = 0; seed < 20; seed += 1) {
      const titles = pickDecoys({ name: "怎么了", artist: "周兴哲", popularity: 71 }, ctx(), seededRng(seed), 3).map((d) => d.title);
      expect(titles).not.toContain("怎麼了");
      expect(titles).not.toContain("你，好不好？");
      const decoys = pickDecoys({ name: "你，好不好？", artist: "周兴哲", popularity: 73 }, ctx(), seededRng(seed));
      expect(decoys).toHaveLength(1);
      // Same-artist tier, shown as the playlist credits him.
      expect(decoys[0].artist).toBe("周兴哲");
      expect(["以後別做朋友", "如果雨之後", "永不失聯的愛"]).toContain(decoys[0].title);
    }
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
  it("asks about a song once when the playlist carries it in both scripts", () => {
    // songKey runs the title through titleKey now, so a playlist that has a
    // mainland release and a Taiwanese one of the same song — 演员 and 演員
    // by the same act — is one question, as a remaster next to the original
    // already was.
    const twice = [
      track("1", "演员", ["Joker Xue"], 72),
      track("2", "演員", ["Joker Xue"], 72),
      track("3", "演员 - Live", ["Joker Xue"], 70),
      track("4", "演员（電影主題曲）", ["Joker Xue"], 70),
      track("5", "演員", ["Someone Else"], 60),
    ];
    expect(usableQuizTracks(twice).map((t) => t.id)).toEqual(["1", "5"]);
  });

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
    expect(verdictFor(5, 10)).toBe("guessing");
    expect(verdictFor(11, 20)).toBe("guessing");
    expect(verdictFor(4, 10)).toBe("stranger");
    expect(verdictFor(0, 10)).toBe("stranger");
    expect(verdictFor(0, 0)).toBe("stranger");
  });

  it("puts chance in its own bucket, below the lowest passing one and above stranger", () => {
    // Two options make chance 50%. The lowest *passing* bucket sits above it,
    // so a coin never reads as "getting there"; but 55% is where a friend who
    // half-knows the playlist most often lands, and "total stranger" for that
    // was the harshest label on the most common score. A coin is "guessing";
    // "stranger" is worse than a coin.
    expect(verdictFor(QUIZ_MAX_QUESTIONS / 2, QUIZ_MAX_QUESTIONS)).toBe("guessing");
    expect(verdictFor(QUIZ_MAX_QUESTIONS / 2 - 1, QUIZ_MAX_QUESTIONS)).toBe("stranger");
    expect(verdictFor(29, 50)).toBe("guessing");
    expect(verdictFor(30, 50)).not.toBe("guessing");
    expect(QUIZ_VERDICTS).toEqual(["soulmate", "close", "acquaintance", "guessing", "stranger"]);
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

  it("dropped the four strings the /quiz page and the panel no longer render, in both languages", () => {
    // `ctaButton` and `notFoundCta` became one `makeYourOwn`; `panelDeviceOnly`
    // and `panelExpires` became one `panelResultsUntil`. A key that stays in
    // the table after its last reader is gone is a translation nobody
    // maintains — and a reader that comes back for it is a compile error,
    // not an empty line, only while the key is really gone.
    for (const gone of ["ctaButton", "notFoundCta", "panelDeviceOnly", "panelExpires"]) {
      expect(gone in QUIZ_COPY.en, gone).toBe(false);
      expect(gone in QUIZ_COPY.zh, gone).toBe(false);
    }
    expect(typeof QUIZ_COPY.en.makeYourOwn).toBe("string");
    expect(typeof QUIZ_COPY.en.panelResultsUntil).toBe("string");
  });

  it("dates the panel's one constraint line — both halves say when the link ends", () => {
    // `panelResultsUntil` folded "results are on this device" and "the link
    // stops working on {date}" into one sentence. The placeholder-parity
    // test above would pass if *both* languages lost the date; this is the
    // assertion that the date is there at all.
    for (const locale of ["en", "zh"] as const) {
      expect(QUIZ_COPY[locale].panelResultsUntil, locale).toContain("{date}");
      expect(fillCopy(QUIZ_COPY[locale].panelResultsUntil, { date: "2026-09-22" }), locale).toContain("2026-09-22");
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
      // An aka is another title, not the same one again.
      for (const a of d.aka ?? []) {
        expect(a.trim()).toBeTruthy();
        expect(titleKey(a), `${d.name} aka ${a}`).not.toBe(titleKey(d.name));
      }
    }
  });

  it("never lists one song twice across an act's names and akas", () => {
    // The duplicate check above keys on the primary title; an aka that
    // equals another entry's name or aka under the same act is the same song
    // listed twice, and a quiz that spends one can still serve the other.
    const seen = new Map<string, string>();
    for (const d of bucketed) {
      for (const key of d.titleKeys) {
        const id = `${key}|${d.artist}`;
        expect(seen.get(id) ?? d.name, `${d.name} — ${d.artist} shares ${id}`).toBe(d.name);
        seen.set(id, d.name);
      }
    }
  });

  it("titles K-pop as Spotify does — in English, with the Hangul as an aka", () => {
    // Spotify lists 봄날 as "Spring Day", 으르렁 as "Growl", 밤편지 as "Through
    // the Night" (2026-09-15). A Hangul `name` here is a title no playlist
    // carries, so the song can be in the playlist and still be the decoy.
    for (const d of QUIZ_DECOY_POOL) {
      expect(scriptBucket(d.name), `${d.name} — ${d.artist}`).not.toBe("ko");
    }
    const spring = QUIZ_DECOY_POOL.find((d) => d.artist === "BTS" && d.name === "Spring Day");
    expect(spring?.aka).toContain("봄날");
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
      const size = bucketed.filter((d) => d.scripts.has(script)).length;
      // latin and zh are where the site's hosts are and must stand on their
      // own. ja leans on the same-artist tier and cross-script fallbacks. ko is
      // small by construction: Spotify titles most K-pop in Latin script, so
      // those entries bucket as `latin` on both sides and reach `ko` only
      // through a Hangul `aka` — the same-artist tier is what serves a K-pop
      // playlist, not this bucket.
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
