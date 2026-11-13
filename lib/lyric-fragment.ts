/**
 * One line of a song, chosen to identify it without giving it away — the
 * question on a `lyric` quiz. Pure: no fetch, no KV, so the suite reaches
 * every rule here (`tests/lyric-fragment.test.ts`); `lib/lyrics.ts` is the
 * half that talks to the lyrics database and caches what this picks.
 *
 * ## Why the question is a line and the cache is a handful of lines
 *
 * A lyric is a literary work with an owner, and showing it is reproduction.
 * The quiz quotes to identify, the way a crossword clue does: one line per
 * question, never a verse, capped at `QUIZ_LYRIC_MAX_CHARS`, and the whole
 * text is never stored — `candidateLines` keeps at most `LYRIC_CANDIDATES_MAX`
 * lines per song, filtered already, so KV holds a snippet index and not a
 * lyrics archive. Those two bounds are the feature's legal posture, and
 * loosening either should be a decision, not a refactor.
 *
 * ## What makes a line a fair question
 *
 * - **Not the title.** Mandopop puts the title in the chorus as a rule (七里香,
 *   小幸運, 演員 all do), and a line that names the song is the answer printed
 *   on the question. Every option's title is excluded — the real song's and
 *   the decoy's, since a line naming the *other* option is a trap. Compared
 *   through `titleKey`, so 演员 in the lyric matches 演員 in the playlist.
 * - **Not a credit.** LRCLIB's first line is often "七里香 - 周杰伦" or
 *   "作詞：方文山"; a line naming the artist, or carrying a credit word, is
 *   furniture.
 * - **Not noise.** "Oh oh oh", "(Yeah)", "---": a line needs a few distinct
 *   tokens — Latin words or Han characters — before it can mean anything.
 * - **The chorus first.** The most repeated line is the one a friend can
 *   place. Ties go to the earlier line, so a given song picks the same line
 *   every time — a quiz is reproducible from its seed, and this must be too.
 */

import { foldHan } from "@/lib/cjk-fold";
import { displayTitle, titleKey } from "@/lib/quiz";
import { QUIZ_LYRIC_MAX_CHARS } from "@/types/quiz";

/**
 * How many lines of one song the cache may hold. Enough that excluding the
 * decoy's title still leaves a line; few enough that the record is a clue
 * index, not the song. Five lines of a forty-line lyric.
 */
export const LYRIC_CANDIDATES_MAX = 5;

/** Fewer tokens than this and a line is "oh yeah" or a single word. */
const MIN_TOKENS = 3;
/** "Yeah yeah yeah" has three tokens and one of them. */
const MIN_DISTINCT_TOKENS = 2;

/** `[00:12.34]` — plainLyrics should carry none, but a publisher's paste can. */
const LRC_TIMESTAMP = /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g;

/**
 * Words that mark a credit or a section label rather than a lyric. Matched
 * case-insensitively against the raw line. Chinese credits need no boundary;
 * the Latin ones get `\b` so "composer" fires and "decomposed" does not.
 */
const CREDIT_WORDS =
  /作[词詞曲]|编曲|編曲|制作|製作|監製|监制|演唱|原唱|填词|填詞|混音|母带|母帶|\b(?:lyrics?|composer|composed|written|arranged|produced|producer|performed|vocals?|mix(?:ed)?|master(?:ed)?)\b/i;
/** `[Chorus]`, `(Verse 2)`, `【副歌】`: a label, however it is bracketed. */
const SECTION_LABEL = /^[\[(（【][^\]）)】]*[\]）)】]$/;
/** Something a word is made of, in any script. */
const WORD_CHAR = /[\p{L}\p{N}]/u;
/** One Han character is one token; a run of Latin letters is one. */
const TOKEN = /\p{Script=Han}|[\p{L}\p{N}][\p{L}\p{N}'’]*/gu;

/** Case, width, whitespace and the Traditional→Simplified fold — the comparison key for a line. */
function foldLine(line: string): string {
  return foldHan(line.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim());
}

/** A folded line with its punctuation and spaces gone, so a title can be found inside it the way `titleKey` spells it. */
function lineKey(line: string): string {
  return foldLine(line).replace(/[\s\p{P}\p{S}]+/gu, "");
}

function tokensOf(line: string): string[] {
  return (line.normalize("NFKC").toLowerCase().match(TOKEN) ?? []).map(foldHan);
}

/**
 * Whether `line` names any of `names` — a title or an artist — compared as
 * `titleKey` compares titles, so a spelling difference across scripts does
 * not let a title through. A name whose key is empty (all punctuation)
 * excludes nothing rather than everything.
 */
function namesAny(line: string, keys: readonly string[]): boolean {
  const key = lineKey(line);
  if (!key) return false;
  return keys.some((k) => k.length > 0 && key.includes(k));
}

/** The keys to exclude: every spelling of a title or credit, through the one fold. */
function excludeKeys(names: readonly string[]): string[] {
  const keys = new Set<string>();
  for (const name of names) {
    if (typeof name !== "string" || !name.trim()) continue;
    // The title as shown and as stored — "Hello - Live" excludes both.
    for (const spelling of [name, displayTitle(name)]) {
      const key = titleKey(spelling);
      if (key) keys.add(key);
    }
  }
  return [...keys];
}

/**
 * Whether a line can be a question at all, before any title is known: a
 * real line of singing, not a credit, label or grunt.
 */
export function isUsableLyricLine(line: string, artistKeys: readonly string[] = []): boolean {
  const trimmed = line.replace(LRC_TIMESTAMP, "").trim();
  if (!trimmed || !WORD_CHAR.test(trimmed)) return false;
  if (SECTION_LABEL.test(trimmed)) return false;
  if (CREDIT_WORDS.test(trimmed)) return false;
  if (namesAny(trimmed, artistKeys)) return false;
  const tokens = tokensOf(trimmed);
  if (tokens.length < MIN_TOKENS) return false;
  if (new Set(tokens).size < MIN_DISTINCT_TOKENS) return false;
  return true;
}

/**
 * A line cut to `QUIZ_LYRIC_MAX_CHARS` code points, at a word boundary where
 * there is one, with an ellipsis. A line within the cap is returned as is.
 */
export function clampLyricLine(line: string, max = QUIZ_LYRIC_MAX_CHARS): string {
  const chars = Array.from(line.trim());
  if (chars.length <= max) return chars.join("");
  const room = Math.max(1, max - 1);
  let cut = chars.slice(0, room).join("");
  // Back up to the last space when one is reasonably close; a Han line has
  // none and is cut where it is.
  const space = cut.lastIndexOf(" ");
  if (space >= Math.floor(room * 0.6)) cut = cut.slice(0, space);
  return `${cut.trimEnd()}…`;
}

/**
 * The lines of one song worth asking about, best first, at most
 * `LYRIC_CANDIDATES_MAX` — what `lib/lyrics.ts` caches per track.
 *
 * `title` is the song's own, excluded here once and for all; `artists` are
 * its credits, excluded as furniture. The decoy's title is not known yet and
 * is excluded at build time by `pickLyricLine`.
 *
 * Order: most repeated first (the chorus), then earliest. Each distinct line
 * appears once, by its folded form, so a chorus sung four times is one
 * candidate with a count of four and not four candidates.
 */
export function candidateLines(
  plainLyrics: string,
  title: string,
  artists: readonly string[] = [],
  max = LYRIC_CANDIDATES_MAX
): string[] {
  if (typeof plainLyrics !== "string" || !plainLyrics.trim()) return [];
  const titleKeys = excludeKeys([title]);
  const artistKeys = excludeKeys(artists);
  const seen = new Map<string, { line: string; count: number; first: number }>();
  const lines = plainLyrics.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.replace(LRC_TIMESTAMP, "").replace(/\s+/g, " ").trim();
    if (!isUsableLyricLine(line, artistKeys)) return;
    if (namesAny(line, titleKeys)) return;
    const key = foldLine(line);
    const entry = seen.get(key);
    if (entry) entry.count += 1;
    else seen.set(key, { line: clampLyricLine(line), count: 1, first: i });
  });
  return [...seen.values()]
    .sort((a, b) => b.count - a.count || a.first - b.first)
    .slice(0, Math.max(0, max))
    .map((e) => e.line);
}

/**
 * The line to quote for one question, from a song's cached candidates, given
 * every title on the question. The first candidate that names none of them
 * — the song's own title was excluded when the candidates were made, so in
 * practice this drops lines that name the decoy. `null` when nothing is
 * left, and the caller asks about a different song or a different decoy.
 */
export function pickLyricLine(candidates: readonly string[], optionTitles: readonly string[]): string | null {
  const keys = excludeKeys(optionTitles);
  for (const line of candidates) {
    if (typeof line !== "string" || !line.trim()) continue;
    if (namesAny(line, keys)) continue;
    return line;
  }
  return null;
}
