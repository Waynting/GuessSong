/**
 * Every sentence the order game's own page (`/order`) shows, in the languages
 * it ships.
 *
 * ## Why this exists
 *
 * Since 2026-11-17 the setup page speaks Brazilian Portuguese to a reader
 * whose browser asks for it (`lib/setup-copy.ts`), and 27% of all games start
 * there (`host_locale:pt`) — most of them this game, "Ponha em ordem". The
 * moment they pressed "Começar o jogo →" they landed on an English page. The
 * setup page now writes `locale: "pt"` onto the game payload
 * (`gameLocaleFor` in `lib/game-session.ts`), and this page reads its words
 * from this table by that locale: absent is English, so every game stored
 * before the field, and every game from `/`, reads exactly as it did.
 *
 * ## Rules
 *
 *   - `Record<OrderLocale, OrderCopy>`, so a missing Portuguese string is a
 *     compile error rather than an English fallback — the `SETUP_COPY` and
 *     `ERROR_MESSAGES` rule.
 *   - `en` is byte-identical to what the page said before the table;
 *     `tests/order-copy.test.ts` pins the critical strings against their old
 *     literals, and reads the page's markup for an English literal left in it.
 *   - Names match the Portuguese setup page: the game is "Ponha em ordem",
 *     the teams are `SETUP_COPY.pt.teams.names` (read from there, not
 *     re-typed).
 *   - Strings that live beside their rules in `lib/` — the leftover note
 *     (`orderLeftoverLine`), the music age (`musicAgeCopy`), the streak
 *     (`streakLine`), the challenge card's lines (`lib/challenge.ts`) — take
 *     the locale as an argument there and are not copied here.
 *   - The saved result image (`lib/result-image.ts`, `downloadResultImage`)
 *     stays English: it is a picture with the brand's own type on it, shared
 *     beyond the room, and its subtitle is pinned by a test.
 *   - The guess game page (`app/game/page.tsx`) stays English; this table is
 *     the order page's only.
 *
 * Pure and dependency-light: imported by the client page, its components and
 * the suite.
 */

import type { GameLocale } from "@/lib/game-session";
import { MIXED_NEXT_GAME_LABEL } from "@/lib/game-over";
import { LOOP_QR_CAPTION } from "@/lib/loop-links";
import { SETUP_COPY } from "@/lib/setup-copy";
import { TEAM_NAMES, type TeamSide } from "@/lib/teams";

export const ORDER_LOCALES = ["en", "pt"] as const;
export type OrderLocale = (typeof ORDER_LOCALES)[number];

/** The page's language for a payload's `locale`: absent (or anything else) is English. */
export function orderLocaleOf(locale: GameLocale | undefined): OrderLocale {
  return locale === "pt" ? "pt" : "en";
}

/** The `lang` attribute for the page's main container, or undefined for the document's own. */
export function orderLang(locale: OrderLocale): string | undefined {
  return locale === "pt" ? "pt-BR" : undefined;
}

export interface OrderCopy {
  loading: string;

  /** The top bar. */
  round: string;
  endGame: string;

  /** The line over the cards. */
  prompt: {
    revealed: string;
    phones: string;
    solo: string;
    /**
     * Under Reveal on round one while no card has moved: a reveal is allowed
     * without an answer. 86% of order games over before their first reveal
     * had moved nothing (2026-11-26).
     */
    unsure: string;
  };

  /** A face-down card, for a screen reader. */
  cardAria: (title: string, position: number, total: number) => string;
  rankAria: (rank: number) => string;
  cardLetterAria: (letter: string) => string;
  /** A Mixed pool's card, revealed: whose playlist it came from. */
  fromPlaylists: (names: readonly string[]) => string;
  /** Beside a revealed card the room had put elsewhere. */
  yours: (slot: number) => string;

  /** The buzzer room's status under the cards. */
  room: {
    reconnect: string;
    connecting: (code: string) => string;
    noPhones: (code: string) => string;
    lockedIn: (code: string, locked: number, total: number) => string;
  };

  reveal: string;

  /** A round graded from the phones. */
  phone: {
    here: string;
    didntPlay: string;
    didntLock: string;
    fullOrder: (points: number) => string;
    oldestRight: (points: number) => string;
    noPoints: string;
  };

  nextRound: string;
  seeFinalScores: string;

  /** A round on the shared screen, revealed. */
  result: {
    allRight: string;
    partial: (inPlace: number, total: number, oldest: boolean) => string;
    untouched: string;
    awarded: (points: number, name: string) => string;
    fullOrderMissed: (points: number) => string;
    whoCalled: (points: number) => string;
    oldestLabel: (points: number) => string;
    notThisTime: string;
    oldestAwarded: (points: number, name: string) => string;
  };

  /** Game Over. */
  gameOver: string;
  finalScores: string;
  pts: string;
  playAgain: string;
  saveResults: string;
  copyMix: string;
  mixCopied: string;
  mixAria: string;
  mixedNextGame: string;
  qrCaption: string;

  /** The sidebar; hidden on a phone. */
  scoreboard: string;

  /** components/team-scoreboard.tsx. */
  teams: {
    names: Record<TeamSide, string>;
    tie: string;
    wins: (team: string) => string;
    ptsEach: string;
    vs: (team: string, total: number) => string;
  };

  /**
   * components/order-challenge.tsx, a friend's challenge game only; its
   * result line is lib/challenge.ts's. The issuing button and its words went
   * with the daily challenge (2026-11-19).
   */
  challenge: {
    againstBody: string;
  };

  /**
   * The daily challenge's Game Over card (components/daily-result.tsx) and
   * the game's name in the top bar. The share line's format is
   * `dailyShareText` in lib/daily.ts, by the same locale.
   */
  daily: {
    playlistName: (n: number) => string;
    title: (n: number) => string;
    scoreLine: (score: number, size: number) => string;
    body: string;
    share: string;
    copied: string;
    tomorrow: string;
    gridAria: (score: number, size: number) => string;
  };
}

export const ORDER_COPY: Record<OrderLocale, OrderCopy> = {
  en: {
    loading: "Loading…",

    round: "Round",
    endGame: "End Game",

    prompt: {
      revealed: "Oldest to newest — the real order",
      phones: "Everyone orders these on their phone. Move one here and yours counts too",
      solo: "Oldest on top. Drag the cards into order, then reveal",
      unsure: "Not sure? Reveal anyway — a guess still counts.",
    },

    cardAria: (title, position, total) => `${title}, position ${position} of ${total}. Arrow keys move it.`,
    rankAria: (rank) => `Rank ${rank}`,
    cardLetterAria: (letter) => `Card ${letter}`,
    fromPlaylists: (names) => (names.length > 1 ? `${names.join(" & ")}'s playlists` : `${names[0]}'s playlist`),
    yours: (slot) => `yours #${slot}`,

    room: {
      reconnect: "Reconnect",
      connecting: (code) => `Connecting to room ${code}…`,
      noPhones: (code) => `Room ${code} · no phones in yet`,
      lockedIn: (code, locked, total) => `Room ${code} · ${locked} of ${total} phones locked in`,
    },

    reveal: "Reveal the Years →",

    phone: {
      here: " (here)",
      didntPlay: "didn't play",
      didntLock: "didn't lock in",
      fullOrder: (points) => `full order +${points}`,
      oldestRight: (points) => `oldest right +${points}`,
      noPoints: "no points",
    },

    nextRound: "Next Round →",
    seeFinalScores: "See Final Scores →",

    result: {
      allRight: "Every card in the right place",
      partial: (inPlace, total, oldest) => `${inPlace} of ${total} in the right place · oldest ${oldest ? "✓" : "✗"}`,
      untouched: "Left as dealt — drag the cards next round to score.",
      awarded: (points, name) => `+${points} pts → ${name}`,
      fullOrderMissed: (points) => `Full order +${points} — not this time`,
      whoCalled: (points) => `Who called the full order? (+${points} pts)`,
      oldestLabel: (points) => `Oldest song +${points}`,
      notThisTime: "not this time",
      oldestAwarded: (points, name) => `+${points} pt → ${name}`,
    },

    gameOver: "Game Over",
    finalScores: "Final Scores",
    pts: "pts",
    playAgain: "Play Again →",
    saveResults: "Save Results",
    copyMix: "Copy the Mix",
    mixCopied: "Copied ✓",
    mixAria: "The mixed playlist, ready to copy",
    mixedNextGame: MIXED_NEXT_GAME_LABEL,
    qrCaption: LOOP_QR_CAPTION,

    scoreboard: "Scoreboard",

    teams: {
      names: TEAM_NAMES,
      tie: "It's a tie",
      wins: (team) => `${team} wins`,
      ptsEach: "pts each",
      vs: (team, total) => `vs ${team} ${total}`,
    },

    challenge: {
      againstBody: "Same songs, same order as your friend's game.",
    },

    daily: {
      playlistName: (n) => `Daily #${n}`,
      title: (n) => `Daily #${n}`,
      scoreLine: (score, size) => `${score}/${size} in the right place`,
      body: "Same five songs for everyone today. Send your grid — no spoilers, just squares.",
      share: "Share my grid",
      copied: "Copied ✓",
      tomorrow: "A new five tomorrow.",
      gridAria: (score, size) => `${score} of ${size} in place`,
    },
  },

  /*
   * Brazilian Portuguese, in the setup page's voice: "Ponha em ordem" is the
   * game, "a mais antiga" the oldest song, "rodada" a round, "Time A/B" the
   * teams. Kept about as long as the English where a line sits in a button
   * or a one-line slot at 390px (Reveal, Next Round, the top bar).
   */
  pt: {
    loading: "Carregando…",

    round: "Rodada",
    endGame: "Encerrar",

    prompt: {
      revealed: "Da mais antiga à mais nova — a ordem certa",
      phones: "Cada um ordena no próprio celular. Mova uma carta aqui e a sua também conta",
      solo: "A mais antiga em cima. Arraste as cartas para pôr em ordem e depois revele",
      unsure: "Não tem certeza? Revele mesmo assim — um chute também vale.",
    },

    cardAria: (title, position, total) => `${title}, posição ${position} de ${total}. Use as setas para mover.`,
    rankAria: (rank) => `${rank}º lugar`,
    cardLetterAria: (letter) => `Carta ${letter}`,
    fromPlaylists: (names) => (names.length > 1 ? `Playlists de ${names.join(" e ")}` : `Playlist de ${names[0]}`),
    yours: (slot) => `você: ${slot}º`,

    room: {
      reconnect: "Reconectar",
      connecting: (code) => `Conectando à sala ${code}…`,
      noPhones: (code) => `Sala ${code} · nenhum celular ainda`,
      lockedIn: (code, locked, total) =>
        `Sala ${code} · ${locked} de ${total} ${total === 1 ? "celular confirmou" : "celulares confirmaram"}`,
    },

    reveal: "Revelar os anos →",

    phone: {
      here: " (aqui)",
      didntPlay: "não jogou",
      didntLock: "não confirmou",
      fullOrder: (points) => `ordem completa +${points}`,
      oldestRight: (points) => `acertou a mais antiga +${points}`,
      noPoints: "sem pontos",
    },

    nextRound: "Próxima rodada →",
    seeFinalScores: "Ver o placar final →",

    result: {
      allRight: "Todas as cartas no lugar certo",
      partial: (inPlace, total, oldest) => `${inPlace} de ${total} no lugar certo · mais antiga ${oldest ? "✓" : "✗"}`,
      untouched: "Ficou como veio — arraste as cartas na próxima rodada para pontuar.",
      awarded: (points, name) => `+${points} pts → ${name}`,
      fullOrderMissed: (points) => `Ordem completa +${points} — não foi desta vez`,
      whoCalled: (points) => `Quem acertou a ordem completa? (+${points} pts)`,
      oldestLabel: (points) => `Música mais antiga +${points}`,
      notThisTime: "não foi desta vez",
      oldestAwarded: (points, name) => `+${points} pt → ${name}`,
    },

    gameOver: "Fim de jogo",
    finalScores: "Placar final",
    pts: "pts",
    playAgain: "Jogar de novo →",
    saveResults: "Salvar resultado",
    copyMix: "Copiar o mix",
    mixCopied: "Copiado ✓",
    mixAria: "A playlist misturada, pronta para copiar",
    mixedNextGame: "Próximo jogo: cada um traz a sua playlist →",
    qrCaption: "Escaneie para criar o seu jogo",

    scoreboard: "Placar",

    teams: {
      names: SETUP_COPY.pt.teams.names,
      tie: "Empate",
      wins: (team) => `${team} venceu`,
      ptsEach: "pts cada",
      vs: (team, total) => `vs ${team} ${total}`,
    },

    challenge: {
      againstBody: "Mesmas músicas, na mesma ordem do jogo do seu amigo.",
    },

    daily: {
      playlistName: (n) => `Desafio do dia #${n}`,
      title: (n) => `Desafio #${n}`,
      scoreLine: (score, size) => `${score}/${size} no lugar certo`,
      body: "As mesmas cinco músicas para todo mundo hoje. Mande seus quadradinhos — sem spoiler.",
      share: "Compartilhar meu resultado",
      copied: "Copiado ✓",
      tomorrow: "Amanhã tem mais cinco.",
      gridAria: (score, size) => `${score} de ${size} no lugar`,
    },
  },
};
