import { describe, it, expect } from "vitest";
import {
  CLIP_COPY,
  afterClipError,
  afterPlayRejected,
  afterSoundStarted,
  classifyPlayRejection,
  startPlayback,
  type ClipPhase,
  type PlaybackResult,
} from "@/lib/clip-start";

/**
 * What the game page does with the `<audio>` element's answer.
 *
 * The page half cannot be tested — vitest cannot import a `.tsx` module here —
 * so the rule is what gets pinned, and tests/game-page.test.ts reads the
 * source to check the page actually asks it.
 */

const PHASES: ClipPhase[] = ["waiting", "playing", "guessing", "revealed", "finished"];

/** A DOMException as a browser hands one over: an object with a `name`. */
const rejection = (name: string) => Object.assign(new Error(`${name}: whatever the browser says`), { name });

describe("a play() rejection is read by its name", () => {
  it("reads the autoplay policy's refusal as blocked", () => {
    expect(classifyPlayRejection(rejection("NotAllowedError"))).toBe("blocked");
  });

  it("reads a pause, or a new src, landing first as interrupted", () => {
    // "The play() request was interrupted by a call to pause()". Whether the
    // pause was ours is not something the rejection knows; afterPlayRejected
    // decides that, from whether the request is still standing.
    expect(classifyPlayRejection(rejection("AbortError"))).toBe("interrupted");
  });

  it("reads a source that would not load as unplayable, which is the error event's to repair", () => {
    expect(classifyPlayRejection(rejection("NotSupportedError"))).toBe("unplayable");
  });

  it("reads anything it does not recognise as blocked, the direction that ends at a button", () => {
    // The alternative is a host left on a spinner nothing will stop.
    for (const odd of [rejection("SecurityError"), rejection(""), new Error("x"), "nope", null, undefined, 7, {}]) {
      expect(classifyPlayRejection(odd)).toBe("blocked");
    }
  });

  it("never reads the message, which is the browser's prose", () => {
    const misleading = Object.assign(new Error("NotAllowedError: play() failed"), { name: "AbortError" });
    expect(classifyPlayRejection(misleading)).toBe("interrupted");
  });
});

describe("startPlayback never throws and never rejects", () => {
  it("reports sound when the promise resolves", async () => {
    await expect(startPlayback({ play: () => Promise.resolve() })).resolves.toBe("sounding");
  });

  it("reports a refusal by its kind", async () => {
    const refused = (name: string) => startPlayback({ play: () => Promise.reject(rejection(name)) });
    await expect(refused("NotAllowedError")).resolves.toBe("blocked");
    await expect(refused("AbortError")).resolves.toBe("interrupted");
    await expect(refused("NotSupportedError")).resolves.toBe("unplayable");
  });

  it("reports pending for a browser whose play() returns nothing", async () => {
    // Before 2017. `undefined.catch` is a TypeError, inside a click handler.
    await expect(startPlayback({ play: () => undefined })).resolves.toBe("pending");
  });

  it("catches a play() that throws instead of returning", async () => {
    const thrower = {
      play: () => {
        throw rejection("NotAllowedError");
      },
    };
    await expect(startPlayback(thrower)).resolves.toBe("blocked");
  });
});

describe("a refused play() must not look like a playing clip", () => {
  /** A refusal of the request the page is still waiting on, in the round on screen. */
  const live = { currentRound: true, standing: true };

  it("puts a blocked first press back at the Play button", () => {
    expect(afterPlayRejected({ ...live, result: "blocked", phase: "waiting" })).toEqual({
      act: "ask_again",
      phase: "waiting",
    });
  });

  it("puts a blocked Resume, Replay or repair at the transport, whose Resume is the tap", () => {
    // Not "playing": that phase shows "Listening…" and runs the clip's
    // countdown, which is exactly what a refused play() must not do.
    for (const phase of ["playing", "guessing"] as const) {
      expect(afterPlayRejected({ ...live, result: "blocked", phase })).toEqual({
        act: "ask_again",
        phase: "guessing",
      });
    }
  });

  it("never lands in a phase that claims sound", () => {
    const results: PlaybackResult[] = ["blocked", "interrupted", "unplayable", "sounding", "pending"];
    for (const result of results) {
      for (const phase of PHASES) {
        for (const currentRound of [true, false]) {
          for (const standing of [true, false]) {
            const verdict = afterPlayRejected({ result, phase, currentRound, standing });
            if (verdict.act === "ask_again") expect(verdict.phase).not.toBe("playing");
          }
        }
      }
    }
  });

  it("drops a refusal that belongs to a round the host has left", () => {
    // Skip Track is rendered *during* the wait, so this is the ordinary case.
    for (const phase of PHASES) {
      expect(afterPlayRejected({ ...live, result: "blocked", phase, currentRound: false })).toEqual({
        act: "ignore",
      });
    }
  });

  it("drops an answer to a request that has been dropped or replaced", () => {
    // Our own pause rejects the play() it interrupts. The page drops the
    // request before it pauses, so that rejection finds nothing standing —
    // which is the only thing that tells it from an interruption we did not
    // cause. Without this, every buzz that landed on a loading clip would
    // tell the host their browser had blocked the sound.
    for (const result of ["blocked", "interrupted"] as const) {
      for (const phase of PHASES) {
        expect(afterPlayRejected({ ...live, result, phase, standing: false })).toEqual({ act: "ignore" });
      }
    }
  });

  it("asks again for an interruption nothing of ours caused", () => {
    // The phone took the audio session; the browser abandoned the load. The
    // request is still standing, the clip is not going to start by itself,
    // and ignoring it leaves the host on a spinner with no Play button.
    expect(afterPlayRejected({ ...live, result: "interrupted", phase: "waiting" })).toEqual({
      act: "ask_again",
      phase: "waiting",
    });
    expect(afterPlayRejected({ ...live, result: "interrupted", phase: "playing" })).toEqual({
      act: "ask_again",
      phase: "guessing",
    });
  });

  it("leaves the scoring card alone when the answer is already up", () => {
    // Reveal moves the phase without ending the round, so the round token
    // cannot speak for it. Going back to "waiting" here takes the card away.
    for (const result of ["blocked", "interrupted"] as const) {
      for (const phase of ["revealed", "finished"] as const) {
        expect(afterPlayRejected({ ...live, result, phase })).toEqual({ act: "ignore" });
      }
    }
  });

  it("leaves a source that would not load to the error event, which can repair it", () => {
    // A second tap would replay the same dead URL.
    for (const phase of PHASES) {
      expect(afterPlayRejected({ ...live, result: "unplayable", phase })).toEqual({ act: "ignore" });
    }
  });

  it("is not a refusal at all when there was sound, or no promise to refuse with", () => {
    for (const result of ["sounding", "pending"] as const) {
      for (const phase of PHASES) {
        expect(afterPlayRejected({ ...live, result, phase })).toEqual({ act: "ignore" });
      }
    }
  });
});

describe("the timers start when there is sound", () => {
  it("counts the window down when there is any of it left", () => {
    for (const phase of ["waiting", "playing", "guessing"] as const) {
      expect(afterSoundStarted({ phase, currentRound: true, windowSpent: false })).toBe("count_down");
    }
  });

  it("plays on without a countdown once the window is spent", () => {
    // The host is deliberately playing the song on while the room thinks.
    for (const phase of ["playing", "guessing"] as const) {
      expect(afterSoundStarted({ phase, currentRound: true, windowSpent: true })).toBe("play_on");
    }
  });

  it("silences sound that starts under the answer card, or for a round that is gone", () => {
    for (const windowSpent of [true, false]) {
      for (const phase of ["revealed", "finished"] as const) {
        expect(afterSoundStarted({ phase, currentRound: true, windowSpent })).toBe("silence");
      }
      for (const phase of PHASES) {
        expect(afterSoundStarted({ phase, currentRound: false, windowSpent })).toBe("silence");
      }
    }
  });
});

describe("an element error is repaired once, and only for a round that is asking", () => {
  const asking = { hasSource: true, starting: false, repairing: false, alreadyRepaired: false };

  it("ignores the error we cause by clearing the src between rounds", () => {
    for (const phase of PHASES) {
      expect(afterClipError({ ...asking, hasSource: false, phase, starting: true })).toBe("ignore");
    }
  });

  it("repairs a clip that dies mid-round", () => {
    for (const phase of ["playing", "guessing"] as const) {
      expect(afterClipError({ ...asking, phase })).toBe("repair");
    }
  });

  it("repairs a clip that fails on its first load, while the phase is still waiting", () => {
    // The phase does not become "playing" until there is sound, so a first
    // load fails in "waiting". Guarding on the phase alone — which is what
    // this replaced — would leave that host on a spinner for good.
    expect(afterClipError({ ...asking, phase: "waiting", starting: true })).toBe("repair");
  });

  it("ignores an error at the Play button nobody has pressed, and under the answer card", () => {
    expect(afterClipError({ ...asking, phase: "waiting", starting: false })).toBe("ignore");
    for (const phase of ["revealed", "finished"] as const) {
      expect(afterClipError({ ...asking, phase, starting: true })).toBe("ignore");
    }
  });

  it("gives up on a track it has repaired already, rather than ignoring the second failure", () => {
    for (const phase of ["playing", "guessing"] as const) {
      expect(afterClipError({ ...asking, phase, alreadyRepaired: true })).toBe("give_up");
    }
    expect(afterClipError({ ...asking, phase: "waiting", starting: true, alreadyRepaired: true })).toBe("give_up");
  });

  it("ignores a second error while the repair is still out — in flight outranks repaired", () => {
    // The same fault reported twice. Read as "repaired and failed again" it
    // would end a clip whose new URL is about to arrive.
    for (const alreadyRepaired of [true, false]) {
      expect(afterClipError({ ...asking, phase: "playing", repairing: true, alreadyRepaired })).toBe("ignore");
    }
  });
});

describe("the three silences are three sentences", () => {
  it("says something different for each", () => {
    const lines = [CLIP_COPY.absent, CLIP_COPY.unavailable, CLIP_COPY.blockedPlay, CLIP_COPY.blockedResume];
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("keeps the sentence a track with no clip has always had", () => {
    expect(CLIP_COPY.absent).toBe("No audio for this track");
  });

  it("does not blame the song for our own throttling", () => {
    // A host told the song has no audio skips a song that was fine.
    expect(CLIP_COPY.unavailable).not.toMatch(/no audio|no preview|no clip/i);
    expect(CLIP_COPY.unavailable).toMatch(/on us/i);
  });

  it("tells a blocked host which button to tap, and blames neither the song nor the playlist", () => {
    expect(CLIP_COPY.blockedPlay).toMatch(/tap play/i);
    expect(CLIP_COPY.blockedResume).toMatch(/tap resume/i);
    for (const line of [CLIP_COPY.blockedPlay, CLIP_COPY.blockedResume]) {
      expect(line).not.toMatch(/no audio|track|song|playlist/i);
    }
  });

  it("is short enough to read mid-party", () => {
    for (const line of Object.values(CLIP_COPY)) expect(line.length).toBeLessThanOrEqual(60);
  });
});
