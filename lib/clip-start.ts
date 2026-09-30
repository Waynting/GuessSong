/**
 * What the game page does once the `<audio>` element has answered.
 *
 * ## The bug this replaced
 *
 * Every `play()` on the game page was `audio.play().catch(() => {})`, and the
 * line after it set the phase to "playing" and started the clip's timers. So
 * a refused `play()` — and a browser is entitled to refuse one that does not
 * come straight from a tap — looked exactly like a playing clip: "Listening…",
 * the equaliser bars, the progress bar counting down, the buzzer round open on
 * every phone, and no sound. The host's only ways out were Reveal and End
 * Game. Whether that is what the pile of early ends at rounds one and two is
 * made of (326 of 676 in the week to 2026-09-29) is what `first_clip:*` in
 * lib/loop-stats.ts is there to say; that it is wrong either way is not in
 * question.
 *
 * The rule now is that **nothing on screen claims sound until the element
 * reports it**. A press asks for sound (`startPlayback`); the round stays
 * where it was until the answer arrives; and the answer is one of the three
 * functions below. The timers are started by the answer, never by the ask.
 *
 * ## Why it is here and not in the page
 *
 * The reason `lib/round-token.ts` gives: the suite reaches `lib/` and cannot
 * import `app/game/page.tsx`, so a rule left in the component is a rule with
 * no test. The page keeps the refs, the element and the `setState` calls;
 * which state to go to is decided here.
 */

/** The game page's phases. Spelled here so this module imports nothing. */
export type ClipPhase = "waiting" | "playing" | "guessing" | "revealed" | "finished";

/**
 * The four places the page calls `play()`.
 *
 *   play    the waiting-phase Play button — the only one that starts a round
 *   resume  the transport's Resume, after a buzz or a Stop
 *   replay  the transport's Replay, from the top
 *   repair  `handleAudioError`, after re-resolving a URL that stopped playing
 *
 * `play` on the lazy path and `repair` always run after an `await`, which
 * puts them outside the tap that caused them. Those are the two a browser's
 * autoplay policy can refuse.
 */
export type ClipSite = "play" | "resume" | "replay" | "repair";

/**
 * How a `play()` came out.
 *
 *   sounding     the promise resolved: the element is playing
 *   pending      `play()` returned no promise (a browser from before 2017);
 *                the `playing` event is the only answer there will be
 *   blocked      refused by the browser — the autoplay policy. The host can
 *                fix this one, with a tap
 *   interrupted  something paused the element or gave it a new `src` before
 *                it had started. Nearly always us — and then not a failure,
 *                because whoever interrupted it has already moved the page
 *                on. `afterPlayRejected` is what tells ours from the rest
 *   unplayable   the element could not load the source. The `error` event
 *                fires for the same fault and owns the repair
 */
export type PlaybackResult = "sounding" | "pending" | "blocked" | "interrupted" | "unplayable";

/**
 * Reads a `play()` rejection by its `name`, never its message: the message
 * is the browser's prose and differs between all of them.
 *
 * Anything unrecognised is `blocked`. That is the safe direction — it puts
 * the host back at a button with a line saying to tap it — where reading an
 * unknown refusal as `unplayable` would leave them on a spinner, waiting on
 * an `error` event that is not coming.
 */
export function classifyPlayRejection(error: unknown): PlaybackResult {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : "";
  if (name === "AbortError") return "interrupted";
  if (name === "NotSupportedError") return "unplayable";
  return "blocked";
}

/**
 * Calls `play()` and reports how it came out. Never throws and never rejects.
 *
 * The `try` is around the call and not only the promise: `play()` throws
 * synchronously on an element in the wrong state in some older engines, and
 * this runs inside a click handler with no boundary of its own under it.
 */
export function startPlayback(audio: {
  play(): Promise<void> | void;
}): Promise<PlaybackResult> {
  let asked: Promise<void> | void;
  try {
    asked = audio.play();
  } catch (error) {
    return Promise.resolve(classifyPlayRejection(error));
  }
  if (!asked || typeof asked.then !== "function") return Promise.resolve("pending");
  return asked.then(
    () => "sounding" as const,
    (error: unknown) => classifyPlayRejection(error)
  );
}

export type RejectionVerdict =
  | { act: "ignore" }
  /**
   * Put the host at a button that plays inside their own tap, with the line
   * saying to tap it. `waiting` is the Play button; `guessing` is the
   * transport, whose Resume is the same thing for a round already under way.
   */
  | { act: "ask_again"; phase: "waiting" | "guessing" };

const IGNORE: RejectionVerdict = { act: "ignore" };

/**
 * A `play()` did not end in sound. Where does the round go?
 *
 * - **The request is no longer standing.** The page drops a request before
 *   it pauses the element and replaces it before it asks again, so by the
 *   time a rejection is delivered, one that was ours to cause finds its
 *   request gone. That is how an `interrupted` of our own making is told
 *   from one that is not: ours never gets this far.
 * - **Not this round's** — the host skipped or ended the game while the
 *   element was making up its mind. The refusal belongs to a card that is no
 *   longer on screen (`lib/round-token.ts`).
 * - **`unplayable`** is the `error` event's, which repairs the URL. A second
 *   tap would replay the same dead URL.
 * - **The answer is up.** Reveal moves the phase without ending the round, so
 *   the round token alone cannot speak for it — the same re-read after the
 *   await that `playClip` does. Putting the phase back to "waiting" here
 *   would take the scoring card off screen.
 *
 * What is left is a refusal in a round the host is still running: `blocked`,
 * or an `interrupted` that nothing of ours caused — the phone taking the
 * audio session for a call, a browser abandoning the load. Neither will
 * start by itself, and both are answered by a tap.
 */
export function afterPlayRejected(input: {
  result: PlaybackResult;
  phase: ClipPhase;
  currentRound: boolean;
  /** The request this answers is still the one the page is waiting on. */
  standing: boolean;
}): RejectionVerdict {
  if (!input.standing || !input.currentRound) return IGNORE;
  if (input.result !== "blocked" && input.result !== "interrupted") return IGNORE;
  if (input.phase === "revealed" || input.phase === "finished") return IGNORE;
  return { act: "ask_again", phase: input.phase === "waiting" ? "waiting" : "guessing" };
}

/**
 * The element reported sound. What does the round do with it?
 *
 *   silence     stop it: the sound belongs to a round that is gone, or the
 *               answer is already up and a clip must not start under it
 *   count_down  the clip's window has time left — run the timers for what
 *               remains, and the phase is "playing"
 *   play_on     the window is spent and the host is deliberately playing the
 *               song on while the room thinks. Nothing to count down to, and
 *               the phase stays where it is rather than snapping around
 */
export type SoundVerdict = "silence" | "count_down" | "play_on";

export function afterSoundStarted(input: {
  phase: ClipPhase;
  currentRound: boolean;
  windowSpent: boolean;
}): SoundVerdict {
  if (!input.currentRound) return "silence";
  if (input.phase === "revealed" || input.phase === "finished") return "silence";
  return input.windowSpent ? "play_on" : "count_down";
}

/**
 * The element fired `error`. Repair, give up, or not ours to answer?
 *
 *   ignore   the element has no `src` (we cleared it between rounds, which
 *            fires `error` too), or the round is not asking for sound: the
 *            answer is up, or the host is at the Play button and has not
 *            pressed it. Or a repair of this track is already in flight —
 *            a failing element can fire `error` more than once
 *   repair   re-resolve the URL, once. Clips sit on a CDN that rotates them
 *   give_up  this track has been repaired already. A URL that fails twice is
 *            not a rotated one, and the round goes to its no-audio state
 *            instead of back to a spinner
 *
 * `starting` is what lets a clip that fails on its *first* load be repaired.
 * The guard used to be the phase alone, which was right when the phase went
 * to "playing" the moment `play()` was called; now it does not until there is
 * sound, so a first load fails with the phase still "waiting".
 *
 * `repairing` is checked before `alreadyRepaired`, and the order is the rule:
 * a second `error` while the repair is still out is the same fault reported
 * twice, and reading it as "repaired, and failed again" would end a clip
 * whose new URL is about to arrive.
 */
export type ErrorVerdict = "ignore" | "repair" | "give_up";

export function afterClipError(input: {
  hasSource: boolean;
  phase: ClipPhase;
  /** A Play press is waiting on the element for this round. */
  starting: boolean;
  /** A repair of this track is in flight. */
  repairing: boolean;
  alreadyRepaired: boolean;
}): ErrorVerdict {
  if (!input.hasSource) return "ignore";
  const asking =
    input.phase === "playing" ||
    input.phase === "guessing" ||
    (input.phase === "waiting" && input.starting);
  if (!asking) return "ignore";
  if (input.repairing) return "ignore";
  return input.alreadyRepaired ? "give_up" : "repair";
}

/**
 * Why a round has no clip. `absent` is a fact about the recording; the other
 * is a fact about us — see `PreviewStatus` in types/preview.ts, which these
 * are the two nulls of.
 */
export type ClipMiss = "absent" | "unavailable";

/**
 * The three silences, in the host's words.
 *
 * They were one sentence. "No audio for this track" was shown for a song
 * nothing has a clip for and for a lookup we were too throttled to make — 821
 * of 22,258 misses in the week to 2026-09-29 — and the second is not a fact
 * about the track, is likely to clear in seconds, and had no Retry. A refused
 * `play()` had no sentence at all.
 *
 * `unavailable` must not blame the song and `blocked` must not blame either:
 * the host reads these mid-party and acts on them, and a host told the song
 * has no audio skips a song that was fine. `tests/clip-start.test.ts` pins it.
 */
export const CLIP_COPY = {
  absent: "No audio for this track",
  unavailable: "Couldn't load this clip. That's on us, not the song",
  /** Under the Play button: the round has not sounded yet. */
  blockedPlay: "Your browser held the sound back. Tap Play again",
  /** Over the transport: the round is under way, and Resume is the button. */
  blockedResume: "Your browser held the sound back. Tap Resume",
  retry: "Try again",
} as const;
