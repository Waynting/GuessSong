/**
 * The setup page's "Today's challenge" fake door.
 *
 * A daily challenge — the same five cards for everyone each day, a Wordle-style
 * grid to paste into a chat — is the one share shape that fits who arrives now:
 * since 2026-11-11 most games are one person alone from Google, and a plain
 * invitation from that person read 1 send in 2,089 shows (`solo_invite`).
 * People alone share a result about themselves. It would also cost almost no
 * Spotify quota (one cached list a day). But it is a product of its own — a
 * daily deal, a grid, a streak — so it is asked before it is built, the way
 * online rooms were (`docs/decisions.md`, the 0.5% door).
 *
 * A card under the form, styled as the Taste Quiz card beside it, because a
 * card is what the real thing would be. Tapped, it says plainly that the
 * challenge does not exist yet, that the tap was counted, and points at the
 * game that already plays alone. It never promises a date.
 *
 * Counted as `daily_door:<stage>` (`lib/loop-stats.ts`): `shown` once per setup
 * page load (drawn after mount, so the copy is in the device's language from
 * its first paint), `tapped` once per page load. The bar agreed on 2026-11-17:
 * `tapped ÷ shown` at or above 3% — six times the online-room door, which was
 * a text link and read 0.5% — before a real daily challenge is built. Retire
 * the card once it has answered: a door that stays up after the question is
 * settled is a promise.
 *
 * In `lib/` so the suite can pin every language; it imports nothing at
 * runtime, because the setup page bundles it.
 */

import type { ErrorLocale } from "@/lib/error-messages";

export interface DailyDoorCopy {
  title: string;
  sub: string;
  /** What it says once tapped: not built, counted, and what plays alone today. */
  note: string;
}

export const DAILY_DOOR_COPY: Record<ErrorLocale, DailyDoorCopy> = {
  en: {
    title: "Today's challenge",
    sub: "Five songs, put them in order — the same deal for everyone today →",
    note:
      "The daily challenge isn't built yet. Your tap was counted, and if enough people ask, " +
      "it's what gets built next. Today, pick \"Just me\" above to play the order game on your own.",
  },
  zh: {
    title: "今日挑戰",
    sub: "五首歌排出年代順序，今天每個人拿到同一副牌 →",
    note:
      "每日挑戰還沒有做。你剛剛這一下已經記下來了，想要的人夠多，下一個就做它。" +
      "現在可以在上面選「Just me」，一個人玩排順序。",
  },
  // Shown on the Portuguese setup page (lib/setup-copy.ts), where the tile
  // the note points at reads "Só eu".
  pt: {
    title: "Desafio do dia",
    sub: "Cinco músicas para pôr em ordem — as mesmas para todo mundo hoje →",
    note:
      "O desafio diário ainda não existe. Seu toque foi contado e, se muita gente pedir, " +
      "é ele que construímos a seguir. Hoje, escolha \"Só eu\" lá em cima para jogar o Ponha em ordem sozinho.",
  },
};
