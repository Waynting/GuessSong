/**
 * Whether pressing Next Track has to tell the buzzer room that nobody scored.
 *
 * The game page used to have a "No one" button for this, and the button
 * carried the rule in where it rendered: the answer was up, no point had
 * been given, and no buzz was waiting on a verdict. With the button gone,
 * Next Track is how a host says nobody got it, so the same three conditions
 * decide whether the room is told — and a room that is told resolves the
 * round on every phone and files a `buzz_round_resolved` with no winner,
 * which is the instrument for "how often does nobody know it".
 *
 * In `lib/` for the reason `lib/round-token.ts` and `lib/start-status.ts`
 * are: the suite cannot import `app/game/page.tsx`, and a rule with four
 * gates that lives in a component is a rule with no test. The component
 * keeps only the null check on the room itself, which is a type guard, not
 * a rule.
 */

export type RoundPhase = "waiting" | "playing" | "guessing" | "revealed" | "finished";

export interface RoundOutcomeInputs {
  phase: RoundPhase;
  /** The song point has been given to someone. */
  pointsAwarded: boolean;
  /** Buzzes still queued for a verdict. */
  buzzesPending: number;
}

export function announcesNoScore({ phase, pointsAwarded, buzzesPending }: RoundOutcomeInputs): boolean {
  // Not from a skip: a round nobody heard the answer to was not a round
  // nobody knew. Not once a point is in: someone did score. Not while a
  // buzz waits: the host has a verdict to give first, and the room resolves
  // itself when they give it.
  return phase === "revealed" && !pointsAwarded && buzzesPending === 0;
}
