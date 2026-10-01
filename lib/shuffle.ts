/**
 * Fisher-Yates, returning a copy.
 *
 * The one shuffle on the site. `Array#sort` with a random comparator is not a
 * uniform shuffle — under V8 it leaves elements near where they started — and
 * the setup page used it: a 300-track playlist cut to 20 songs drew its first
 * fifty tracks about 1.5× as often as it should and its last fifty about half
 * as often, so a host replaying one playlist kept hearing its opening songs.
 * Two correct copies of this function existed beside it at the time, which is
 * why there is now one, here, and `tests/shuffle.test.ts` reads the app for a
 * random comparator.
 *
 * Pure, so the browser bundle can import it.
 */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
