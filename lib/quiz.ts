/**
 * The playlist quiz — "how well do you know my music taste?" — as pure rules.
 *
 * A host turns a playlist into a link; a friend opens it on their own phone
 * and, question by question, picks which of two songs is really in the
 * playlist. This module builds those questions, grades the answers and ranks
 * the board. It holds no KV, no fetch and no React, for the reason
 * `lib/room-poll.ts` and `lib/song-count.ts` give: the suite reaches `lib/`,
 * and a rule left in a route handler or a page component is a rule with no
 * test.
 *
 * ## The quiz is the excuse; the link is the product
 *
 * Every loop surface the site has is either a passive footer (1–2%), a QR on
 * a television (1%), or a QR printed into an image (0 of 50, ever). This is
 * the first one whose carrier is a URL someone taps in a group chat, and whose
 * impression happens on a page of ours. The measured question is not "is the
 * quiz fun" but "does a link-shaped surface convert where a QR did not" — see
 * the `quiz_result` surface in lib/loop-links.ts.
 *
 * ## Why there is no audio in the questions
 *
 * Previews are the hottest path in the app (CLAUDE.md, "Previews are
 * per-track"). A quiz that played a clip per question would multiply that by
 * the number of friends, and a throttled minute would land as a silent quiz on
 * a cold visitor who has never seen the site. So the question is answered from
 * titles, and a clip is a *hint*: fetched lazily, only when tapped, and
 * rationed by `hintAllowance` so that guessing stays the default behaviour.
 *
 * ## Where the decoys come from
 *
 * Not from Spotify: a second upstream call per creation would double the cold
 * cost of the one thing the whole playlist path is shaped around. Not from
 * other people's cached playlists: a data flow between strangers, even if the
 * playlists are public. From a built-in pool (`lib/quiz-decoys.ts`), chosen so
 * the decoy is as close to the playlist as the pool allows — first another song
 * by the same artist, then by any artist in the playlist, then the same script
 * and a similar popularity. The tiers are pinned by `tests/quiz.test.ts`.
 */

import type { Track } from "@/types";
import {
  QUIZ_DEFAULT_QUESTION_COUNT,
  QUIZ_MAX_QUESTIONS,
  QUIZ_MIN_QUESTIONS,
  QUIZ_OPTION_COUNT,
  QUIZ_QUESTION_COUNTS,
  type QuizOption,
  type QuizQuestionView,
  type QuizScore,
} from "@/types/quiz";
import type { CountControl, SongCountState } from "@/lib/song-count";
// A 20KB character table. It stays out of the browser bundle only because
// nothing a client component imports from this module reaches it — the build
// tree-shakes it away, not a module boundary. Never reference `titleKey`,
// `bucketPool` or `foldText` at module scope here (a memoised
// `bucketPool(QUIZ_DECOY_POOL)` is the obvious one); do that in the route.
import { foldHan } from "@/lib/cjk-fold";

/* ------------------------------------------------------------------ */
/* Script buckets                                                      */
/* ------------------------------------------------------------------ */

/**
 * Which writing system a track lives in, as far as decoys are concerned.
 *
 * A Mandopop playlist handed English decoys is a quiz anyone can pass by
 * eliminating the odd ones out, so decoys are drawn from the same bucket as the
 * real track. Detected from the strings rather than hand-tagged on the pool,
 * so the pool and the playlist are bucketed by one rule and cannot disagree —
 * a K-pop track titled in Latin script lands in `latin` on both sides.
 *
 * Deliberately not `lib/mixed-playlist.ts`'s `fingerprint()`: that is a string
 * identity and this is a classification, and the two answer different
 * questions.
 */
export type ScriptBucket = "latin" | "zh" | "ja" | "ko";

const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;
const KANA = /[\u3040-\u309f\u30a0-\u30ff\u31f0-\u31ff\uff66-\uff9f]/;
const CJK_IDEOGRAPHS = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/**
 * Kana decides `ja` before ideographs decide `zh`: a Japanese title is almost
 * always kanji *and* kana, a Chinese one is ideographs alone. A kanji-only
 * Japanese title reads as `zh`, which is the cheaper mistake — it gets Chinese
 * decoys rather than none.
 */
export function scriptBucket(...parts: Array<string | undefined>): ScriptBucket {
  const text = parts.filter(Boolean).join(" ");
  if (HANGUL.test(text)) return "ko";
  if (KANA.test(text)) return "ja";
  if (CJK_IDEOGRAPHS.test(text)) return "zh";
  return "latin";
}

/* ------------------------------------------------------------------ */
/* Names and titles                                                    */
/* ------------------------------------------------------------------ */

/**
 * A taker's name, folded to what identifies them on one quiz's board.
 *
 * Mirrors `lib/room.ts`'s `fold` rather than importing it: that module reaches
 * for lib/kv.ts, and this one has to stay importable by the test suite and by
 * client code without dragging the Upstash client along. Same rule, same
 * reason — case-insensitive because "alice" being taken by "Alice" is the
 * duplicate check people expect — and the store must derive the hash field
 * from this and nothing else.
 */
export function foldQuizName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * An artist credit as a key — `foldedArtists`, `creditedArtists`, the
 * same-artist tier and the artist half of `songKey`. Case, whitespace, NFKC
 * and the Traditional→Simplified fold `titleKey` uses, for the reason it uses
 * it: Spotify credits a mainland act in whichever script the release used, so
 * a playlist crediting 薛之谦 has to reach the pool's 薛之謙 alias or the
 * same-artist tier never fires for it and `displayArtist` shows the other
 * script beside the playlist's own. Not the qualifier or punctuation strip —
 * a credit has neither.
 */
function foldText(value: string): string {
  return foldHan(value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " "));
}

/**
 * ` - Remastered 2011`, ` – Live`, `－ Live`: a spaced dash — hyphen, en or em
 * dash, the full-width hyphen, or the two Unicode hyphens U+2010/U+2011 — and
 * everything after it. `[\s\S]*` rather than `.*`: with `.` the tail could
 * not cross a line terminator, so on a title of `x<spaces>-<spaces>y\nz` the
 * engine retried every split of both whitespace runs before giving up —
 * cubic, 1.2s at 3,000 characters — while a title with a newline after the
 * dash kept its tail. Now the tail always matches and the worst case is the
 * quadratic all-space one the bracket rule below shares (~100ms at 16k,
 * which nothing sends).
 */
const TRAILING_DASH_QUALIFIER = /\s+[-–—－‐‑]\s+[\s\S]*$/;
/**
 * `(feat. …)`, `[Live]`, and their full-width forms: Spotify stores a mainland
 * or Hong Kong release's qualifier as 光亮（大型紀錄片《紫禁城》主題歌）, and one
 * Taiwanese release as 路過人間 (電視劇《…》插曲） — ASCII opener, full-width
 * closer — so any opener may pair with any closer.
 */
const TRAILING_BRACKET_QUALIFIER = /\s*[(\[（［【][^)\]）］】]*[)\]）］】]\s*$/;

/**
 * The title as an answer option shows it.
 *
 * Spotify stores "Karma Police - Remastered 2011" and "Señorita (feat. Camila
 * Cabello)"; the decoy pool stores plain titles. Left as-is, the qualifier is a
 * tell — the one option with " - Remastered" on it is the real one. Only a
 * trailing ` - …` and a trailing bracketed group come off, so "(Sittin' On)
 * The Dock of the Bay" and "Hip-Hop Is Dead" keep their names. The stored
 * track keeps the full title, because the preview lookup wants it.
 */
export function displayTitle(name: string): string {
  const trimmed = name.trim();
  const stripped = trimmed
    .replace(TRAILING_DASH_QUALIFIER, "")
    .replace(TRAILING_BRACKET_QUALIFIER, "")
    .trim();
  return stripped || trimmed;
}

/** Whitespace, punctuation and symbols: nothing a title is identified by. */
const TITLE_NOISE = /[\s\p{P}\p{S}]+/gu;

/**
 * A title as a key — the one place a title becomes one, for the reason
 * `lib/room.ts` has one `fold()`: "is this decoy already in the playlist" is
 * decided by comparing these, and a second spelling of the fold is a second
 * answer to that question.
 *
 * Loose on purpose, and every fold here was a song that reached the wrong side
 * of a question. Spotify lists a mainland act's catalogue in Simplified
 * Chinese where the pool is written in Traditional (演员 / 演員, 像我这样的人 /
 * 像我這樣的人 — `foldHan`), spells a title with or without the spaces (Play我呸
 * / Play 我呸) or the dots (踩.腳.踏.車 / 踩...腳踏車), and puts a curly
 * apostrophe on one release and a straight one on another (God’s Menu). NFKC
 * folds full-width Latin and the compatibility ideographs first. Two different
 * songs that fold together cost one decoy that was fine; one song that does
 * not fold together puts the playlist's own song up as the wrong answer.
 */
export function titleKey(name: string): string {
  const folded = foldHan(displayTitle(name).normalize("NFKC").toLowerCase());
  return folded.replace(TITLE_NOISE, "") || folded.trim();
}

/**
 * The identity of a playlist track for asking about a song once
 * (`usableQuizTracks`): the title through `titleKey`, plus the folded primary
 * artist. The exclusion is title-only and lives in `pickDecoys`; this is the
 * one place the artist joins the key, so "Hello" by Adele and "Hello" by
 * Lionel Richie are two questions while "Hello - Live" and "Hello" are one.
 */
export function songKey(name: string, artist: string): string {
  return `${titleKey(name)}|${foldText(artist)}`;
}

/* ------------------------------------------------------------------ */
/* Decoys                                                              */
/* ------------------------------------------------------------------ */

export interface DecoyEntry {
  name: string;
  /**
   * The artist as Spotify's API names them — which for nearly every Chinese
   * and Japanese act is romanised: a playlist track by 周杰倫 arrives as
   * "Jay Chou", by 五月天 as "Mayday", by 米津玄師 as "Kenshi Yonezu"
   * (measured with one artist search per pool act; only 告五人, 吳青峰,
   * 理想混蛋 and 信樂團 keep a native name). This is the string the tiers
   * match on, so it has to be Spotify's.
   */
  artist: string;
  /**
   * Other spellings of the same act, native script first. Matched by the
   * tiers like `artist`, and by `displayArtist` against the playlist's own
   * credits — an act the playlist names is shown as the playlist names it,
   * and one it does not is shown in the real track's script, because the
   * option whose spelling nothing else on the quiz uses is the answer.
   */
  aliases?: readonly string[];
  /**
   * Other titles Spotify lists the same recording under, for the exclusion
   * and for display in the real option's script. K-pop is the case: Spotify
   * titles BTS's 봄날 "Spring Day", IU's 밤편지 "Through the Night", EXO's
   * 으르렁 "Growl" (measured 2026-09-15), and a title-only exclusion cannot
   * bridge a translation the way `titleKey` bridges a spelling. `name` is
   * Spotify's title, because that is what a playlist carries; the native one
   * goes here, and is what a Hangul-titled real option is shown beside.
   */
  aka?: readonly string[];
  /** Spotify's 0–100, approximately. Only compared, never shown. */
  popularity: number;
}

/** A pool entry with the derived fields the picker keys on. */
export interface BucketedDecoy extends DecoyEntry {
  /** Every bucket one of its titles lands in. The same-script tiers read this. */
  scripts: ReadonlySet<ScriptBucket>;
  /** `titleKey` of `name`: the entry's identity. */
  titleKey: string;
  /** `titleKey` of every title, `aka` included. What excludes a decoy that is in the playlist. */
  titleKeys: ReadonlySet<string>;
  /** Every spelling of the act, folded. */
  foldedArtists: ReadonlySet<string>;
}

/** Every title a decoy goes by: Spotify's, then its `aka`s. */
function titlesOf(decoy: DecoyEntry): string[] {
  return [decoy.name, ...(decoy.aka ?? [])];
}

export function bucketPool(pool: readonly DecoyEntry[]): BucketedDecoy[] {
  return pool.map((entry) => {
    const titles = titlesOf(entry);
    const bucketOf = (title: string) => scriptBucket(...(entry.aliases ?? []), entry.artist, title);
    return {
      ...entry,
      scripts: new Set(titles.map(bucketOf)),
      titleKey: titleKey(entry.name),
      titleKeys: new Set(titles.map(titleKey)),
      foldedArtists: new Set([entry.artist, ...(entry.aliases ?? [])].map(foldText)),
    };
  });
}

/**
 * Which title of a decoy to show: the first one in the real option's script,
 * else Spotify's. The title-side half of `displayArtist`'s script rule, and
 * only ever different from `name` through `aka` — a K-pop entry shows "Spring
 * Day" beside "Dynamite" and 봄날 beside 예뻤어. The script is read off the
 * title as the taker sees it: "Dynamite (feat. 지민)" is shown as "Dynamite",
 * and bucketing the qualifier would put 봄날 beside it.
 */
export function displayDecoyTitle(decoy: DecoyEntry, targetName: string): string {
  const wanted = scriptBucket(displayTitle(targetName));
  return titlesOf(decoy).find((t) => scriptBucket(t) === wanted) ?? decoy.name;
}

/**
 * Which spelling of a decoy's artist to show next to a real track.
 *
 * Two rules, and the order is the point. **An act the playlist credits is
 * shown exactly as the playlist credits it**, whatever script the real option
 * on this question is in. Matching the real option's script per question
 * kept each question internally consistent and leaked across them: a Mandopop
 * playlist credits most acts romanised ("Ronghao Li", "JJ Lin") and a few
 * natively (那英, 黃小琥), so Q2 showed 李白 · 李榮浩 (real option by 那英)
 * while Q4 showed 對等關係 · Ronghao Li (real) — and a taker who had seen
 * "Ronghao Li" once knew 李榮浩 was never the playlist's spelling. The first
 * tier's decoys are by the real track's own artist and the second tier's by
 * another playlist artist, so this is most decoys, not a corner.
 *
 * Only an act the playlist never credits falls to the script rule: a Jay Chou
 * playlist gets "Mayday", not 五月天, and a 告五人 playlist gets 周杰倫, not
 * "Jay Chou". Falls back to Spotify's name when no alias is in that script.
 * The second argument is optional so the rule reads the same with no
 * playlist in hand.
 */
export function displayArtist(
  decoy: DecoyEntry,
  targetArtist: string,
  playlistArtists?: ReadonlyMap<string, string>
): string {
  const candidates = [decoy.artist, ...(decoy.aliases ?? [])];
  if (playlistArtists) {
    for (const candidate of candidates) {
      const credited = playlistArtists.get(foldText(candidate));
      if (credited !== undefined) return credited;
    }
  }
  const wanted = scriptBucket(targetArtist);
  return candidates.find((a) => scriptBucket(a) === wanted) ?? decoy.artist;
}

/**
 * Every act the playlist credits, folded, mapped to the spelling it credits
 * them under. The first spelling seen wins; Spotify has one name per artist
 * id, so a second spelling of one act is two artist ids and, unless the two
 * fold together (周興哲 and 周兴哲 do, through `foldText`), two keys here.
 * This is what `displayArtist` reads, and it is the only place a playlist
 * credit becomes a key — the same reason `lib/room.ts` has one `fold()`.
 */
export function creditedArtists(tracks: readonly Track[]): Map<string, string> {
  const credited = new Map<string, string>();
  for (const t of tracks) {
    if (!Array.isArray(t.artists)) continue;
    for (const a of t.artists) {
      if (typeof a !== "string" || !a.trim()) continue;
      const folded = foldText(a);
      if (!credited.has(folded)) credited.set(folded, a);
    }
  }
  return credited;
}

/** How far apart two popularity scores may be and still count as "similar". */
export const DECOY_POPULARITY_WINDOW = 20;

export interface DecoyContext {
  /**
   * Every title in the playlist as `titleKey` keys it, so no decoy is also a
   * right answer. Title alone, not title-and-artist: the pool and the playlist
   * spell an artist differently often enough (see `DecoyEntry.artist`) that
   * keying on both let 晴天 by 周杰倫 be offered next to 晴天 by Jay Chou.
   */
  playlistTitles: ReadonlySet<string>;
  /**
   * Every credited artist in the playlist, folded, to the spelling the
   * playlist uses (`creditedArtists`). The keys decide the second tier; the
   * values are what `displayArtist` shows for an act the playlist knows.
   */
  playlistArtists: ReadonlyMap<string, string>;
  pool: readonly BucketedDecoy[];
  /** Decoys already spent on earlier questions of this quiz. */
  used: Set<string>;
}

interface DecoyTarget {
  name: string;
  artist: string;
  popularity?: number;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The wrong answer(s) for one right one — `QUIZ_OPTION_COUNT - 1`, which is
 * one — as close to home as the pool allows. The tiers below were written for
 * three and lose nothing at one: with a single decoy the *first* tier that
 * has anything decides the whole question, so "another song by the same
 * artist" is what most questions become, which is the hardest shape there is.
 *
 * The tiers, in order, and why the order is the point:
 *   1. another song by the *same* artist — "they love The Weeknd, but is Save
 *      Your Tears actually in there?" This is most of what a Spotify top-tracks
 *      call would buy, for free.
 *   2. a song by some *other* artist in the playlist — still the owner's taste,
 *      still not in the playlist.
 *   3. same script, popularity within `DECOY_POPULARITY_WINDOW` — so a deep-cut
 *      playlist does not get a chart-topper as the obvious odd one out.
 *   4. same script, any popularity.
 *   5. anything left, then anything at all — a pool bucket can run dry against
 *      a playlist that contains most of it, and a question with two options is
 *      worse than one whose decoys repeat.
 *
 * Never a song whose title is in the playlist, at any tier and under any of
 * its titles: that would put the right answer on both sides of the question.
 * The artist is shown as the playlist credits them, or failing that in the
 * real track's script (`displayArtist`); the title likewise
 * (`displayDecoyTitle`).
 */
export function pickDecoys(
  target: DecoyTarget,
  ctx: DecoyContext,
  rng: () => number,
  count = QUIZ_OPTION_COUNT - 1
): QuizOption[] {
  const targetTitle = titleKey(target.name);
  const targetArtist = foldText(target.artist);
  const script = scriptBucket(target.artist, target.name);
  const identity = (d: BucketedDecoy) => `${d.titleKey}|${d.artist}`;

  const eligible = ctx.pool.filter((d) => {
    for (const key of d.titleKeys) {
      if (key === targetTitle || ctx.playlistTitles.has(key)) return false;
    }
    return true;
  });
  const fresh = eligible.filter((d) => !ctx.used.has(identity(d)));

  const sameArtist = (d: BucketedDecoy) => d.foldedArtists.has(targetArtist);
  const inPlaylist = (d: BucketedDecoy) => [...d.foldedArtists].some((a) => ctx.playlistArtists.has(a));
  const tiers: Array<(d: BucketedDecoy) => boolean> = [
    sameArtist,
    (d) => !sameArtist(d) && inPlaylist(d),
    (d) =>
      d.scripts.has(script) &&
      typeof target.popularity === "number" &&
      Math.abs(d.popularity - target.popularity) <= DECOY_POPULARITY_WINDOW,
    (d) => d.scripts.has(script),
    () => true,
  ];

  const chosen: BucketedDecoy[] = [];
  const taken = new Set<string>();
  const take = (candidates: BucketedDecoy[]) => {
    for (const d of shuffle(candidates, rng)) {
      if (chosen.length >= count) return;
      if (taken.has(identity(d))) continue;
      taken.add(identity(d));
      chosen.push(d);
    }
  };

  for (const tier of tiers) {
    if (chosen.length >= count) break;
    take(fresh.filter(tier));
  }
  // The pool ran dry for this quiz: allow a decoy to appear twice rather than
  // ship a question with fewer than `QUIZ_OPTION_COUNT` options.
  if (chosen.length < count) take(eligible);

  for (const d of chosen) ctx.used.add(identity(d));
  return chosen.map((d) => ({
    title: displayDecoyTitle(d, target.name),
    artist: displayArtist(d, target.artist, ctx.playlistArtists),
  }));
}

/* ------------------------------------------------------------------ */
/* Building                                                            */
/* ------------------------------------------------------------------ */

/** What the server stores per question. The taker gets `stripAnswerKey` of it. */
export interface QuizQuestion {
  options: QuizOption[];
  /** Index into `options` of the song that is really in the playlist. */
  answer: number;
  /**
   * The real track, for the hint. Full Spotify title rather than the display
   * one, and the running time, because that is what lib/preview-cache.ts picks
   * a recording by.
   */
  track: { id: string; name: string; artist: string; durationMs: number };
}

/**
 * The tracks a quiz can be built from: those with a name and an id, one per
 * song. A playlist with the same recording twice must not ask about it twice,
 * and a track `parseGamePayload` would have repaired (`artists: []`) is still a
 * question — the artist line is just empty.
 */
export function usableQuizTracks(tracks: readonly Track[]): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const t of tracks) {
    if (!t || typeof t.id !== "string" || !t.id || typeof t.name !== "string" || !t.name.trim()) {
      continue;
    }
    const key = songKey(t.name, primaryArtist(t));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function primaryArtist(track: Track): string {
  return Array.isArray(track.artists) && typeof track.artists[0] === "string"
    ? track.artists[0]
    : "";
}

/** Clamp a requested count to what the playlist can support. */
/**
 * The setup page's question-count control, bounded for the quiz. Hands
 * `lib/song-count.ts`'s state machine the quiz's pills and range so the two
 * rules that module pins — reject a half-typed number per keystroke, clamp an
 * out-of-range one on blur — apply here without a second copy of them.
 */
export const QUIZ_COUNT_CONTROL: CountControl = Object.freeze({
  presets: QUIZ_QUESTION_COUNTS,
  min: QUIZ_MIN_QUESTIONS,
  max: QUIZ_MAX_QUESTIONS,
});

export const DEFAULT_QUIZ_COUNT_STATE: SongCountState = Object.freeze({
  count: QUIZ_DEFAULT_QUESTION_COUNT,
  field: "",
});

/** The control's count as a number; the quiz has no "all" and never will. */
export function quizCountOf(state: SongCountState): number {
  return typeof state.count === "number" ? state.count : QUIZ_DEFAULT_QUESTION_COUNT;
}

export function clampQuestionCount(requested: number, usable: number): number {
  const wanted = Number.isFinite(requested)
    ? Math.min(QUIZ_MAX_QUESTIONS, Math.max(QUIZ_MIN_QUESTIONS, Math.trunc(requested)))
    : QUIZ_MIN_QUESTIONS;
  return Math.min(wanted, usable);
}

export interface BuildQuizInput {
  tracks: readonly Track[];
  questionCount: number;
  pool: readonly DecoyEntry[];
  /** Injected so a seed reproduces a quiz and a test can pin one. */
  rng: () => number;
}

/**
 * Builds the questions. Returns fewer than asked when the playlist is short,
 * and none at all below `QUIZ_MIN_QUESTIONS` — the caller decides what to say
 * about that (`quiz_too_few_tracks`), this just does not build a two-question
 * quiz.
 */
export function buildQuiz(input: BuildQuizInput): QuizQuestion[] {
  const usable = usableQuizTracks(input.tracks);
  if (usable.length < QUIZ_MIN_QUESTIONS) return [];
  const count = clampQuestionCount(input.questionCount, usable.length);

  const playlistTitles = new Set<string>();
  for (const t of usable) playlistTitles.add(titleKey(t.name));

  const ctx: DecoyContext = {
    playlistTitles,
    playlistArtists: creditedArtists(usable),
    pool: bucketPool(input.pool),
    used: new Set(),
  };

  return shuffle(usable, input.rng)
    .slice(0, count)
    .map((track) => {
      const artist = primaryArtist(track);
      const real: QuizOption = { title: displayTitle(track.name), artist };
      const decoys = pickDecoys(
        { name: track.name, artist, popularity: track.popularity },
        ctx,
        input.rng
      );
      const options = shuffle([real, ...decoys], input.rng);
      return {
        options,
        answer: options.indexOf(real),
        track: {
          id: track.id,
          name: track.name,
          artist,
          durationMs: typeof track.durationMs === "number" ? track.durationMs : 0,
        },
      };
    });
}

/** What leaves the server. The key stays behind, or the board means nothing. */
export function stripAnswerKey(questions: readonly QuizQuestion[]): QuizQuestionView[] {
  return questions.map((q) => ({ options: q.options }));
}

/**
 * A board row as every taker may see it: the score, not which questions it
 * came from. `right` exists for the owner's per-question rates and stays on
 * the token-gated board; on the public view it would hand every phone a
 * per-question correctness map of everyone else.
 */
export function publicScore(score: QuizScore): QuizScore {
  const { name, correct, total, hintsUsed, at } = score;
  return { name, correct, total, hintsUsed, at };
}

/* ------------------------------------------------------------------ */
/* Grading                                                             */
/* ------------------------------------------------------------------ */

export interface GradedQuiz {
  correct: number;
  total: number;
  key: number[];
  /** Indexes answered correctly, ascending. */
  right: number[];
}

/**
 * Grades against the stored key, tolerantly. A short, long, non-integer or
 * out-of-range answer is simply wrong — the same spirit as `parseGamePayload`:
 * a client that sends something odd gets a score, not a 500.
 */
export function gradeAnswers(questions: readonly QuizQuestion[], answers: unknown): GradedQuiz {
  const given = Array.isArray(answers) ? answers : [];
  const right: number[] = [];
  questions.forEach((q, i) => {
    const a = given[i];
    if (Number.isInteger(a) && a === q.answer) right.push(i);
  });
  return { correct: right.length, total: questions.length, key: questions.map((q) => q.answer), right };
}

/** The shape a client must send, checked before grading. */
export function isAnswerList(value: unknown, questionCount: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === questionCount &&
    value.every((a) => Number.isInteger(a) && a >= 0 && a < QUIZ_OPTION_COUNT)
  );
}

/* ------------------------------------------------------------------ */
/* Hints                                                               */
/* ------------------------------------------------------------------ */

/**
 * One hint per ten questions, at least one. 10 → 1, 20 → 2, 30 → 3, 50 → 5.
 *
 * Rationed rather than priced. Half a point for a hinted answer makes "8.5 /
 * 10" and invites using the hint on every question; a small allowance makes
 * guessing the default and the clip the thing you save for the one you cannot
 * place, which is what "guess first, then hear it" asks for. The count is a
 * tiebreak on the board, not a penalty.
 *
 * Was one per five with four options. With two, a hint is a guaranteed point
 * rather than a nudge, so the same ratio would hand a fifty-question quiz ten
 * free answers — a fifth of the score.
 */
export function hintAllowance(questionCount: number): number {
  return Math.max(1, Math.round(questionCount / 10));
}

/**
 * The client's own count of hints it played, bounded by what it could have.
 * The server cannot attribute a hint to a taker — there is no identity to hang
 * it on — so this is trusted and clamped, and only ever breaks ties.
 */
export function clampHintsUsed(value: unknown, questionCount: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
  return Math.max(0, Math.min(n, hintAllowance(questionCount)));
}

/* ------------------------------------------------------------------ */
/* Verdicts                                                            */
/* ------------------------------------------------------------------ */

/**
 * Five buckets, so the result is a sentence rather than a decimal. "83.7%" is
 * a promise ten questions cannot keep; "close friend" is what the number
 * actually supports. The thresholds are on the ratio so every question count
 * reads the same way.
 *
 * The lowest passing bucket sits *above* chance. With `QUIZ_OPTION_COUNT`
 * two, chance is 50%, and the 40% floor that four options allowed would have
 * handed "getting there" to a coin. 60% is where a friend starts to show over
 * the noise at twenty questions; the two above it are unchanged in spirit and
 * moved up to keep the gaps even.
 *
 * `guessing` is the band a coin lands in, 50–59%, and it exists because the
 * harshest label used to start there: a friend who half-knows the playlist
 * lands at 55% more often than anywhere else, and "total stranger" for that
 * is a verdict nobody screenshots into the chat. `stranger` now means below
 * chance — worse than guessing, which is its own kind of knowing.
 */
export const QUIZ_VERDICTS = ["soulmate", "close", "acquaintance", "guessing", "stranger"] as const;
export type QuizVerdict = (typeof QUIZ_VERDICTS)[number];

export function verdictFor(correct: number, total: number): QuizVerdict {
  if (total <= 0) return "stranger";
  const ratio = correct / total;
  if (ratio >= 0.9) return "soulmate";
  if (ratio >= 0.75) return "close";
  if (ratio >= 0.6) return "acquaintance";
  if (ratio >= 0.5) return "guessing";
  return "stranger";
}

const VERDICT_SET: ReadonlySet<string> = new Set(QUIZ_VERDICTS);

export function isQuizVerdict(value: unknown): value is QuizVerdict {
  return typeof value === "string" && VERDICT_SET.has(value);
}

/* ------------------------------------------------------------------ */
/* The board                                                           */
/* ------------------------------------------------------------------ */

/**
 * Most right answers first; among equals, fewer hints; among those, earlier.
 * Stable, and never mutates the input — the store reads hash fields in no
 * particular order and this is the only place order is decided.
 */
export function sortScoreboard(entries: readonly QuizScore[]): QuizScore[] {
  return [...entries].sort(
    (a, b) =>
      b.correct - a.correct ||
      a.hintsUsed - b.hintsUsed ||
      a.at - b.at ||
      a.name.localeCompare(b.name)
  );
}

/**
 * What the owner's page derives from the rows: how many took it, the mean, and
 * per question how many of those who recorded results got it right. Rows
 * written before `right` existed count toward the mean and not toward the
 * per-question figures, which is why `answered` is carried per question
 * rather than assumed equal to `takers`.
 */
export function summarizeBoard(
  scores: readonly QuizScore[],
  questionCount: number
): { takers: number; averageCorrect: number | null; perQuestion: Array<{ answered: number; correct: number }> } {
  const perQuestion = Array.from({ length: questionCount }, () => ({ answered: 0, correct: 0 }));
  let sum = 0;
  for (const s of scores) {
    sum += s.correct;
    if (!Array.isArray(s.right)) continue;
    const right = new Set(s.right.filter((i) => Number.isInteger(i) && i >= 0 && i < questionCount));
    for (let i = 0; i < questionCount; i += 1) {
      perQuestion[i].answered += 1;
      if (right.has(i)) perQuestion[i].correct += 1;
    }
  }
  return {
    takers: scores.length,
    averageCorrect: scores.length ? sum / scores.length : null,
    perQuestion,
  };
}

/**
 * Takers a question needs before "everyone" or "nobody" means anything. With
 * one, every question is 100% or 0% and both labels are true of half the
 * board.
 */
export const BOARD_TILE_MIN_ANSWERED = 2;

export interface BoardTiles {
  /** Index of the first question every answering taker got right. */
  easiest?: number;
  /** Index of the first question no answering taker got right. */
  hardest?: number;
}

/**
 * The two hero tiles on the owner's board — "everyone knew" and "nobody could
 * place" — or fewer. Each is literal: a unanimous question, judged by at least
 * `BOARD_TILE_MIN_ANSWERED` takers, the first such one on a tie. The page
 * used to pick the highest and lowest rate and label the higher "everyone
 * knew" from 50% up, which with two takers on opposite sheets put every
 * question at 50% and still crowned one "Everyone knew · 1 of 2 got it".
 * Neither tile applying is a real answer — the board splits — and the page
 * renders nothing rather than a tile whose label is false.
 */
export function pickBoardTiles(questions: readonly { answered: number; correct: number }[]): BoardTiles {
  const tiles: BoardTiles = {};
  for (const [i, q] of questions.entries()) {
    if (q.answered < BOARD_TILE_MIN_ANSWERED) continue;
    if (tiles.easiest === undefined && q.correct === q.answered) tiles.easiest = i;
    if (tiles.hardest === undefined && q.correct === 0) tiles.hardest = i;
  }
  return tiles;
}

/** 1-based position of `name` on a sorted board, or null if absent. */
export function rankOf(sorted: readonly QuizScore[], name: string): number | null {
  const folded = foldQuizName(name);
  const index = sorted.findIndex((e) => foldQuizName(e.name) === folded);
  return index === -1 ? null : index + 1;
}

/* ------------------------------------------------------------------ */
/* Randomness                                                          */
/* ------------------------------------------------------------------ */

/**
 * mulberry32. Small, fast, and reproducible from one 32-bit seed, which is all
 * a quiz needs: the route seeds it from `crypto`, the tests from a constant.
 */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
