/**
 * Constant-time string comparison, so a wrong host-token guess cannot be
 * timed. Shared by `lib/room.ts` (pool consumption) and `lib/quiz-store.ts`
 * (the results page); lives on its own so the quiz store does not have to
 * import the whole room module for ten lines.
 */

import { timingSafeEqual } from "node:crypto";

export function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against a same-length buffer anyway so the failure path takes
    // roughly the same time as a length-matched mismatch.
    timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
