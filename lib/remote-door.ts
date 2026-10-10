/**
 * The setup page's "play online" fake door.
 *
 * An online room — players in different places, each hearing the clip on
 * their own phone — is a different product from the one this is: the host
 * judges what the room shouts, and nothing is played anywhere but the host's
 * device. It would cost a clip per listener, a judge who cannot hear anyone,
 * and an autoplay unlock on every phone, so it is not built on a hunch. This
 * line asks first: a link under Start that, tapped, says plainly that it does
 * not exist yet and points at the one thing that already works at a distance,
 * the Taste Quiz.
 *
 * Counted as `remote_door:<stage>` (`lib/loop-stats.ts`): `shown` once per
 * setup page load, `tapped` once per page load. `shown` is every page load,
 * not a host who has typed a room's worth of names, so `tapped ÷ shown` is not
 * the Mixed nudge's rate; read the taps beside the games already played with
 * phones in the room (`game_mode:buzzer`, Mixed). Retire the line once it has
 * answered — a door that stays up after the question is settled is a promise.
 *
 * Lives in `lib/` so the suite can pin both languages; it imports nothing at
 * runtime, because the setup page bundles it.
 */

import type { ErrorLocale } from "@/lib/error-messages";

export interface RemoteDoorCopy {
  /** The link under Start. */
  link: string;
  /** What it says once tapped: not built, counted, and what works today. */
  note: string;
  /** The link to the Taste Quiz inside the note. */
  quiz: string;
}

/**
 * Written for each language rather than translated. The note must say the room
 * does not exist and must not promise a date: the tap is the question.
 */
export const REMOTE_DOOR_COPY: Record<ErrorLocale, RemoteDoorCopy> = {
  en: {
    link: "Friends in different places? Play online →",
    note:
      "Online rooms aren't built yet. Your tap was counted, and if enough hosts ask, " +
      "it is what gets built next. Today, a Taste Quiz link works from anywhere.",
    quiz: "Make a Taste Quiz →",
  },
  zh: {
    link: "朋友不在同一個地方？線上一起玩 →",
    note:
      "線上房間還沒有做。你剛剛這一下已經記下來了，想要的人夠多，下一個就做它。" +
      "現在想隔空玩，可以先開一份歌單測驗連結傳給朋友。",
    quiz: "做一份歌單測驗 →",
  },
};
