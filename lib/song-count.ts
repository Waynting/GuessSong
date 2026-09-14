/**
 * How many tracks of a playlist a game plays.
 *
 * The presets and the custom field share one value: `songCount` in
 * `app/page.tsx` is either `"all"` or a number, and a typed count is just a
 * number that happens not to be in `SONG_COUNTS`. Keeping it that way is why
 * the start path stays a single `slice` with nothing to reconcile.
 *
 * These live here rather than in the component because the test suite only
 * reaches `lib/`, and the clamping rule below is the part worth pinning.
 */

/** The one-tap counts, in the order the pills render. */
export const SONG_COUNTS: (number | "all")[] = [10, 20, 30, 50, "all"];

/**
 * Ceiling on a custom count. Mirrors `MAX_PLAYLIST_TRACKS` in `lib/spotify.ts`
 * — copied rather than imported, because that module is server code and
 * importing it into the setup page would pull the Spotify client into the
 * browser bundle. Anything above this can never be satisfied:
 * `fetchPlaylistTracks` reads at most that many tracks however long the
 * playlist is.
 */
export const MAX_SONG_COUNT = 500;

/**
 * What a count control is bounded by: its pills, and the range the typed
 * field accepts. The game's is below; the quiz's is `QUIZ_COUNT_CONTROL` in
 * `lib/quiz.ts` (ten to fifty, no "all"). Every function here takes one and
 * defaults to the game's, so the two rules the module exists for — reject per
 * keystroke, clamp on blur — are written once and bounded twice, rather than
 * copied into a second module where one of them would quietly drift.
 */
export interface CountControl {
  presets: readonly (number | "all")[];
  min: number;
  max: number;
}

export const SONG_COUNT_CONTROL: CountControl = Object.freeze({
  presets: SONG_COUNTS,
  min: 1,
  max: MAX_SONG_COUNT,
});

/** True for a count that has its own pill, so no custom field describes it. */
export function isSongCountPreset(
  count: number | "all",
  control: CountControl = SONG_COUNT_CONTROL
): boolean {
  return control.presets.includes(count);
}

/**
 * The custom field's value if it names a usable count, else null.
 *
 * Used on every keystroke, so it must reject rather than clamp: a host typing
 * "150" passes through "1" and "15", and committing those would leave the
 * count wherever they paused. Out of range means "not yet", not "no".
 */
export function parseSongCount(
  raw: string,
  control: CountControl = SONG_COUNT_CONTROL
): number | null {
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < control.min || n > control.max) return null;
  return n;
}

/**
 * The same, but for a field the host has finished with: a number outside the
 * range is pulled to the nearest end rather than rejected.
 *
 * Rejecting on commit would leave the last in-range *prefix* selected, so
 * typing 999 committed 99 — the field snapping to a number nobody typed, from
 * a rule nothing on screen states. Clamping answers 500, which is at least the
 * count they asked for as far as it can be given.
 *
 * Null means the field says nothing at all (empty, or not a number), which is
 * the caller's cue to fall back to whatever is already selected rather than to
 * invent a count.
 */
export function clampSongCount(
  raw: string,
  control: CountControl = SONG_COUNT_CONTROL
): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Math.floor(Number(trimmed));
  if (!Number.isFinite(n)) return null;
  return Math.min(control.max, Math.max(control.min, n));
}

/**
 * What the control holds: the selected count, and the custom field's text.
 *
 * `field` is presentation and `count` is the answer, which is the whole reason
 * they are separate — a number field passes through states that are not yet a
 * count ("", "-", "1" on the way to "150"), and the game must not follow the
 * field there. An empty `field` means a preset pill is selected.
 */
export interface SongCountState {
  count: number | "all";
  field: string;
}

/**
 * Frozen because it is one module-level object handed to every mount as its
 * initial state. Every transition below returns a new object, so nothing
 * mutates it today; freezing is what keeps a future in-place edit from
 * poisoning the default for every game started afterwards.
 */
export const DEFAULT_SONG_COUNT_STATE: SongCountState = Object.freeze({
  count: 20,
  field: "",
});

/** Host tapped a preset pill: it wins, and the custom field steps aside. */
export function selectPreset(preset: number | "all"): SongCountState {
  return { count: preset, field: "" };
}

/**
 * Host typed. Commits only a usable count, so the game never follows the field
 * through a half-typed number; the previous count stands until the new one is
 * real.
 */
export function typeCustom(
  state: SongCountState,
  raw: string,
  control: CountControl = SONG_COUNT_CONTROL
): SongCountState {
  return { count: parseSongCount(raw, control) ?? state.count, field: raw };
}

/**
 * Host left the field. Now — and only now — an out-of-range number is clamped
 * rather than ignored, and the field is rewritten to whatever is actually
 * selected. Leaving a value on screen that never became the count is the bug
 * this closes: it promises a game length that is not going to happen.
 */
export function commitCustom(
  state: SongCountState,
  control: CountControl = SONG_COUNT_CONTROL
): SongCountState {
  const n = clampSongCount(state.field, control);
  if (n !== null) return { count: n, field: String(n) };
  return {
    count: state.count,
    field: isSongCountPreset(state.count, control) ? "" : String(state.count),
  };
}

/** True when the field holds the selected count, so it should read as chosen. */
export function isCustomSelected(
  state: SongCountState,
  control: CountControl = SONG_COUNT_CONTROL
): boolean {
  return state.field !== "" && parseSongCount(state.field, control) === state.count;
}
