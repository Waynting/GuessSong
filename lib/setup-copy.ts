/**
 * Every sentence the setup page (`/`) shows, in the languages it ships.
 *
 * ## Why this exists
 *
 * Brazil became the largest market in the traffic wave that began on
 * 2026-11-11 (loads peak 22:00–04:00 Brasília), and a Brazilian first-timer
 * read the site-wide quota notice as a personal limit and wrote in
 * Portuguese. The error table (`lib/error-messages.ts`) gained a `pt` half for
 * every code; this is the other half — the form those errors sit under.
 *
 * ## How a reader gets Portuguese without an English flash
 *
 * `/` is prerendered and must stay that way. `middleware.ts` (matcher `/`
 * only) reads `Accept-Language` and, when the reader's top preference is
 * Portuguese, rewrites — not redirects — to `/pt`, a second prerendered
 * route that renders the same `SetupPage` with `locale="pt"`. The URL stays
 * `/`, the HTML is Portuguese from the first byte, and Googlebot (English)
 * gets today's `/` unchanged. `/pt` is `noindex` with a canonical to `/`, so
 * it never competes with `/` in search. `docs/decisions.md` has the
 * rejected-localisation row this partially reopens.
 *
 * ## Rules
 *
 *   - `Record<SetupLocale, SetupCopy>`, so a missing Portuguese string is a
 *     compile error rather than an English fallback, the `ERROR_MESSAGES`
 *     rule.
 *   - `en` is byte-identical to what `app/page.tsx` said before the table;
 *     `tests/setup-copy.test.ts` pins the strings that matter (Start, the
 *     tiles, the status ladder) against their old literals.
 *   - The hero `<h2>` is NOT here, deliberately. It stays English on both
 *     pages: it is the phrase Google ranks `/` for, and the owner asked that
 *     it never be touched without asking.
 *   - The footer's "What's new" overlay and `lib/changelog.ts` stay en/zh.
 *
 * Pure and dependency-light: imported by the client page, `lib/start-status.ts`
 * and the suite.
 */

import { ORDER_BLURB, orderSummary } from "@/lib/order-game";
import { THEME_CAPTION, type ChipRowKind, type StarterKey } from "@/lib/starter-playlists";
import { TEAM_NAMES } from "@/lib/teams";
import { challengeBanner } from "@/lib/challenge";

export const SETUP_LOCALES = ["en", "pt"] as const;
export type SetupLocale = (typeof SETUP_LOCALES)[number];

export function isSetupLocale(value: unknown): value is SetupLocale {
  return typeof value === "string" && (SETUP_LOCALES as readonly string[]).includes(value);
}

/**
 * The setup languages a game start is counted under: `host_locale:<l>` on
 * the `game_started` pulse. English is absent on purpose — it is every other
 * game, and a key on each of ~3k starts a day would be a command per start
 * spent saying so. The key tail comes from this closed set and nothing else.
 */
export const COUNTED_SETUP_LOCALES = ["pt"] as const;
export type CountedSetupLocale = (typeof COUNTED_SETUP_LOCALES)[number];

export function isCountedSetupLocale(value: unknown): value is CountedSetupLocale {
  return typeof value === "string" && (COUNTED_SETUP_LOCALES as readonly string[]).includes(value);
}

export interface SetupCopy {
  /** "Who's playing?" and its three tiles. */
  whoQuestion: string;
  who: {
    solo: { title: string; sub: string };
    group: { title: string; sub: string };
    mixed: { title: string; sub: string };
  };
  faqs: { q: string; a: string }[];

  playlistLabel: string;
  playlistPlaceholder: string;
  collectLabel: string;
  useQrInstead: string;

  playersLabel: string;
  playerPlaceholder: (n: number) => string;
  removePlayer: (n: number) => string;
  addPlayer: string;
  buzzerNudge: { guessLead: string; orderLead: string; guessCta: string; orderCta: string };

  settingsLabel: string;
  summary: {
    guess: string;
    order: string;
    clips: (seconds: number) => string;
    songsPerPlayer: (n: number) => string;
    orderSongs: (count: number | "all") => string;
    allSongs: string;
    songs: (n: number) => string;
    phones: string;
    buzzer: string;
    on: string;
    off: string;
  };
  settingsDone: string;
  settingsChange: string;

  gameLabel: string;
  guessPill: string;
  orderPill: string;
  guessBlurb: string;
  orderBlurb: string;

  clipLabel: string;
  clipPill: (seconds: number) => string;
  songCountLabel: string;
  allPill: string;
  customPlaceholder: string;
  customAria: (max: number) => string;
  perPlayerLabel: string;

  buzzerLabel: { guess: string; order: string };
  buzzerOn: string;
  buzzerTurnOn: string;
  buzzerHelp: { guess: string; order: string };

  roomLabel: string;
  passPhoneInstead: string;

  loading: string;
  start: string;

  quizCardTitle: string;
  quizCardSub: string;

  whatIsTitle: string;
  whatIsBody: string;
  howToPlay: string;
  faqTitle: string;
  guidesTitle: string;
  allGuides: string;

  /** The line above the card when the form was restored (`RecallNote`). */
  recall: { line: string; startFresh: string };
  /** The chip rows' heads, and the sentence over a row of starters alone. */
  chipRow: Record<ChipRowKind, string>;
  starterCaption: (count: number) => string;
  /** The sentence over a "Pick a theme" row alone (`THEME_CAPTION`). */
  themeCaption: string;

  /** "Split into two teams" under a roster of four or more (lib/teams.ts). */
  teams: {
    toggle: string;
    off: string;
    on: string;
    /** On, but a swap left a side under two: played without teams. */
    needTwo: string;
    /** The chip's screen-reader line: who is on which side, and the move a tap makes. */
    chipAria: (name: string, side: string, other: string) => string;
    names: { a: string; b: string };
  };

  /** A friend's "beat my score" link, over Start (lib/challenge.ts `challengeBanner`). */
  challengeBanner: (score: number, max: number) => string;
  /** What each starter chip says. The names are ours, not Spotify's. */
  starters: Record<StarterKey, { name: string; blurb: string }>;

  /** The line under Start (`lib/start-status.ts`). */
  status: {
    addPlayers: (n: number) => string;
    openRoom: string;
    waitingPlaylists: (n: number) => string;
    phonesReady: (n: number) => string;
    nobodyScanned: string;
  };

  /** The room card (`components/room-panel.tsx`). */
  room: {
    describe: (collectsPlaylists: boolean, buzzer: boolean, orderGame: boolean) => string;
    yourName: string;
    hostCanPlay: { guess: string; order: string };
    opening: string;
    open: string;
    shareTitle: (code: string) => string;
    qrAlt: (code: string) => string;
    linkCopied: string;
    shareLink: string;
    orSendLink: string;
    reconnect: string;
    connecting: string;
    inTheRoom: (n: number) => string;
    noPlaylistYet: string;
    tracks: (n: number) => string;
    away: string;
    nobodyYetBuzzer: string;
    nobodyYet: string;
    hostPlaylistIn: (n: number, from: string) => string;
    addYourOwn: string;
    adding: string;
    addMine: string;
    oneCodeBoth: string;
  };

  /** Pass-the-phone (`components/mixed-playlist-collector.tsx`). */
  collector: {
    full: (max: number) => string;
    added: (name: string) => string;
    passOn: string;
    next: string;
    yourName: string;
    namePlaceholder: string;
    nameTaken: string;
    yourPlaylist: string;
    addAndPass: string;
    joined: (n: number) => string;
    remove: (name: string) => string;
  };
}

const PLAYLIST_PLACEHOLDER = "https://open.spotify.com/playlist/... or /album/... or /artist/...";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const SETUP_COPY: Record<SetupLocale, SetupCopy> = {
  en: {
    whoQuestion: "Who's playing?",
    who: {
      // The game described once, with the fold's pill: lib/order-game.ts.
      solo: { title: "Just me", sub: ORDER_BLURB },
      group: { title: "A group", sub: "Play a clip, everyone shouts the title." },
      mixed: { title: "Everyone's playlists", sub: "Everyone adds a playlist, guess whose song." },
    },
    faqs: [
      {
        q: "How do you play the guess the song game?",
        a: "Paste a public Spotify playlist and add everyone's names. A short clip plays, everyone guesses out loud, and the host taps whoever got it first: 3 points for the song, 1 for the album.",
      },
      {
        q: "Do I need a Spotify account, and is it free?",
        a: "No account, no login, nothing to pay. GuessSong is free and open source.",
      },
      {
        q: "Can everyone use their own playlist?",
        a: "Yes. Pick \"Everyone brings a playlist\" and GuessSong mixes them into one pool, with a bonus point for guessing whose song it was.",
      },
      {
        q: "Which playlists work?",
        a: "Any public playlist or album link; private playlists and Spotify's own (Discover Weekly and the like) can't be read. Clips come from iTunes and Deezer, and the few songs with none are skipped.",
      },
    ],

    playlistLabel: "Spotify Playlist, Album or Artist",
    playlistPlaceholder: PLAYLIST_PLACEHOLDER,
    collectLabel: "Collect Playlists",
    useQrInstead: "Use a QR code instead →",

    playersLabel: "Players",
    playerPlaceholder: (n) => `Player ${n}`,
    removePlayer: (n) => `Remove player ${n}`,
    addPlayer: "Add Player",
    buzzerNudge: {
      guessLead: "Everyone has a phone? Buzz in from them. ",
      orderLead: "Everyone has a phone? Each arranges on theirs. ",
      guessCta: "Turn on Buzzer Mode →",
      orderCta: "Play on phones →",
    },

    settingsLabel: "Settings",
    summary: {
      guess: "Guess the song",
      order: "Put them in order",
      clips: (s) => `${s}s clips`,
      songsPerPlayer: (n) => `${n} songs per player`,
      orderSongs: (count) => orderSummary(count),
      allSongs: "All songs",
      songs: (n) => `${n} songs`,
      phones: "Phones",
      buzzer: "Buzzer",
      on: "on",
      off: "off",
    },
    settingsDone: "Done ▴",
    settingsChange: "Change ▾",

    gameLabel: "Game",
    guessPill: "Guess the song",
    orderPill: "Put them in order",
    guessBlurb: "Play a clip, everyone shouts the title, you award the points.",
    orderBlurb: ORDER_BLURB,

    clipLabel: "Clip Duration",
    clipPill: (s) => `${s}s`,
    songCountLabel: "Number of Songs",
    allPill: "All",
    customPlaceholder: "Custom",
    customAria: (max) => `Custom number of songs, 1 to ${max}`,
    perPlayerLabel: "Songs Per Player",

    buzzerLabel: { guess: "Buzzer Mode", order: "Play on phones" },
    buzzerOn: "✓ On",
    buzzerTurnOn: "Turn on",
    buzzerHelp: {
      guess: "Everyone buzzes from their phone.",
      order: "Everyone puts the cards in order on their own phone, and each phone is scored for itself.",
    },

    roomLabel: "Room",
    passPhoneInstead: "Pass this phone around instead →",

    loading: "Loading playlist",
    start: "Start Game →",

    quizCardTitle: "Not playing right now?",
    quizCardSub: "Make a Taste Quiz link for friends →",

    whatIsTitle: "What is GuessSong?",
    whatIsBody:
      "A free music guessing game for parties. Paste any public Spotify playlist, play short clips, and race to name the song. No login.",
    howToPlay: "How to play →",
    faqTitle: "Frequently asked questions",
    guidesTitle: "Guides",
    allGuides: "All guides →",

    recall: { line: "Filled in from your last game here.", startFresh: "Start fresh" },
    chipRow: { recent: "Recent", starters: "Starter playlists", themes: "Themes", playlists: "Playlists" },
    themeCaption: THEME_CAPTION,
    teams: {
      toggle: "Split into two teams",
      off: "Off",
      on: "On",
      needTwo: "2 a side needed",
      chipAria: (name, side, other) => `${name} is on ${side}. Move to ${other}`,
      names: { a: TEAM_NAMES.a, b: TEAM_NAMES.b },
    },
    challengeBanner: (score, max) => challengeBanner(score, max),
    starterCaption: (count) =>
      count === 1 ? "No playlist handy? Start with ours" : "No playlist handy? Try one of these",
    starters: {
      party_hits: {
        name: "Party Hits 2010–2026",
        blurb: "The songs everyone knows from the last fifteen years.",
      },
      reggaeton: {
        name: "Reggaetón Viejo",
        blurb: "Old-school reggaetón: Don Omar, Wisin & Yandel, Arcángel.",
      },
      decades: { name: "Hits from every decade", blurb: "Songs everyone knows, 1960s to now." },
    },

    status: {
      addPlayers: (n) => `Add ${n} more player${plural(n, "", "s")} to start`,
      openRoom: "Open the room first",
      waitingPlaylists: (n) => `Waiting for ${n} more playlist${plural(n, "", "s")}`,
      phonesReady: (n) => `${n} phone${plural(n, "", "s")} ready`,
      nobodyScanned: "Nobody has scanned yet — you can still start",
    },

    room: {
      describe: (collectsPlaylists, buzzer, orderGame) => {
        const gets = orderGame ? "the cards" : "a buzzer";
        if (collectsPlaylists && buzzer) {
          return `One QR code does both — players scan it to add a playlist and get ${gets}.`;
        }
        if (collectsPlaylists) return "Players scan a QR code to add their own playlist.";
        return `Players scan a QR code to get ${gets} on their phone.`;
      },
      yourName: "Your name",
      hostCanPlay: {
        guess: "You can buzz from this screen too.",
        order: "You can play from this screen too.",
      },
      opening: "Opening Room...",
      open: "Open Room",
      shareTitle: (code) => `Join room ${code} on GuessSong`,
      qrAlt: (code) => `QR code to join room ${code}`,
      linkCopied: "✓ Link copied",
      shareLink: "Share Join Link",
      orSendLink: "Or send the link.",
      reconnect: "Reconnect",
      connecting: "Connecting to room…",
      inTheRoom: (n) => `${n} in the room`,
      noPlaylistYet: " · no playlist yet",
      tracks: (n) => ` · ${n} tracks`,
      away: " (away)",
      nobodyYetBuzzer: "Nobody yet — latecomers can join mid-game.",
      nobodyYet: "Nobody yet.",
      hostPlaylistIn: (n, from) => `✓ Your playlist is in — ${n} track${plural(n, "", "s")} from ${from}`,
      addYourOwn: "Add your own playlist too.",
      adding: "Adding...",
      addMine: "Add My Playlist",
      oneCodeBoth: "One code does both — playlists close when the game starts, buzzers stay open.",
    },

    collector: {
      full: (max) => `${max} players is the max — remove someone to add another.`,
      added: (name) => `✓ ${name}'s playlist is in`,
      passOn: "Pass the phone to the next player",
      next: "Next Player →",
      yourName: "Your Name",
      namePlaceholder: "Player name",
      nameTaken: "That name already joined — pick a different one.",
      yourPlaylist: "Your Spotify Playlist",
      addAndPass: "Add & Pass Phone →",
      joined: (n) => `${n} player${plural(n, "", "s")} joined`,
      remove: (name) => `Remove ${name}`,
    },
  },

  /*
   * Brazilian Portuguese, written for a party host rather than translated
   * word for word. Two names are fixed and must match the error table's
   * Portuguese, which refers to them: the games are "Adivinhe a música" and
   * "Ponha em ordem", and the setting is "Número de músicas".
   */
  pt: {
    whoQuestion: "Quem vai jogar?",
    who: {
      solo: { title: "Só eu", sub: "Quatro músicas, da mais antiga à mais nova. Sem som — o jogo marca os pontos sozinho." },
      group: { title: "Um grupo", sub: "Toca um trecho, todo mundo grita o nome da música." },
      mixed: { title: "Playlist de cada um", sub: "Cada um adiciona uma playlist; adivinhem de quem é a música." },
    },
    faqs: [
      {
        q: "Como se joga o jogo de adivinhar a música?",
        a: "Cole uma playlist pública do Spotify e adicione o nome de todo mundo. Toca um trecho curto, todos chutam em voz alta, e o anfitrião toca em quem acertou primeiro: 3 pontos pela música, 1 pelo álbum.",
      },
      {
        q: "Preciso de conta no Spotify? É grátis?",
        a: "Sem conta, sem login, sem pagar nada. O GuessSong é gratuito e open source (código aberto).",
      },
      {
        q: "Cada um pode usar a própria playlist?",
        a: "Pode. Escolha \"Playlist de cada um\" e o GuessSong junta todas numa só, com um ponto extra para quem adivinhar de quem era a música.",
      },
      {
        q: "Quais playlists funcionam?",
        a: "Qualquer link de playlist ou álbum público; playlists privadas e as do próprio Spotify (Descobertas da Semana e parecidas) não podem ser lidas. Os trechos vêm do iTunes e do Deezer, e as poucas músicas sem trecho são puladas.",
      },
    ],

    playlistLabel: "Playlist, álbum ou artista do Spotify",
    playlistPlaceholder: "https://open.spotify.com/playlist/... ou /album/... ou /artist/...",
    collectLabel: "Juntar playlists",
    useQrInstead: "Usar um QR code →",

    playersLabel: "Jogadores",
    playerPlaceholder: (n) => `Jogador ${n}`,
    removePlayer: (n) => `Remover jogador ${n}`,
    addPlayer: "Adicionar jogador",
    buzzerNudge: {
      guessLead: "Todo mundo tem celular? Cada um aperta a campainha no seu. ",
      orderLead: "Todo mundo tem celular? Cada um organiza no seu. ",
      guessCta: "Ligar o Modo Campainha →",
      orderCta: "Jogar nos celulares →",
    },

    settingsLabel: "Configurações",
    summary: {
      guess: "Adivinhe a música",
      order: "Ponha em ordem",
      // Just the length: "trechos de 15s" wrapped "Mudar ▾" onto a second
      // line at 390px and pushed Start 32px further down than English.
      clips: (s) => `${s}s`,
      songsPerPlayer: (n) => `${n} músicas por jogador`,
      orderSongs: (count) => {
        // Shorter than the English on purpose: any round count after it
        // ("(5 rodadas de 4)", ", 5 rodadas") wrapped "Mudar ▾" onto a second
        // line at 390px. The rounds are on the order page itself.
        return count === "all" ? "Todas as músicas" : `${count} músicas`;
      },
      allSongs: "Todas as músicas",
      songs: (n) => `${n} músicas`,
      phones: "Celulares",
      buzzer: "Campainha",
      on: "ligada",
      off: "desligada",
    },
    settingsDone: "Pronto ▴",
    settingsChange: "Mudar ▾",

    gameLabel: "Jogo",
    guessPill: "Adivinhe a música",
    orderPill: "Ponha em ordem",
    guessBlurb: "Toca um trecho, todo mundo grita o nome da música, e você dá os pontos.",
    orderBlurb: "Quatro músicas, da mais antiga à mais nova. Sem som — o jogo marca os pontos sozinho.",

    clipLabel: "Duração do trecho",
    clipPill: (s) => `${s}s`,
    songCountLabel: "Número de músicas",
    allPill: "Todas",
    customPlaceholder: "Outro",
    customAria: (max) => `Outro número de músicas, de 1 a ${max}`,
    perPlayerLabel: "Músicas por jogador",

    buzzerLabel: { guess: "Modo Campainha", order: "Jogar nos celulares" },
    buzzerOn: "✓ Ligado",
    buzzerTurnOn: "Ligar",
    buzzerHelp: {
      guess: "Todo mundo aperta a campainha no próprio celular.",
      order: "Cada um põe as cartas em ordem no próprio celular, e cada celular ganha seus próprios pontos.",
    },

    roomLabel: "Sala",
    passPhoneInstead: "Passar este celular de mão em mão →",

    loading: "Carregando a playlist",
    start: "Começar o jogo →",

    quizCardTitle: "Não vai jogar agora?",
    quizCardSub: "Crie um link de Quiz de Gosto para os amigos →",

    whatIsTitle: "O que é o GuessSong?",
    whatIsBody:
      "Um jogo gratuito de adivinhar músicas para festas. Cole qualquer playlist pública do Spotify, toque trechos curtos e dispute quem diz o nome da música primeiro. Sem login.",
    howToPlay: "Como jogar (em inglês) →",
    faqTitle: "Perguntas frequentes",
    guidesTitle: "Guias (em inglês)",
    allGuides: "Todos os guias →",

    recall: { line: "Preenchido com o seu último jogo aqui.", startFresh: "Começar do zero" },
    chipRow: { recent: "Recentes", starters: "Playlists para começar", themes: "Temas", playlists: "Playlists" },
    themeCaption: "Escolha um tema",
    teams: {
      toggle: "Dividir em dois times",
      off: "Desligado",
      on: "Ligado",
      needTwo: "Precisa de 2 por time",
      chipAria: (name, side, other) => `${name} está no ${side}. Mudar para o ${other}`,
      names: { a: "Time A", b: "Time B" },
    },
    challengeBanner: (score, max) => `Seu amigo fez ${score} de ${max} nesta playlist — tente superar`,
    starterCaption: (count) =>
      count === 1 ? "Sem playlist à mão? Comece com a nossa" : "Sem playlist à mão? Experimente uma destas",
    starters: {
      party_hits: {
        name: "Party Hits 2010–2026",
        blurb: "As músicas que todo mundo conhece dos últimos quinze anos.",
      },
      reggaeton: {
        name: "Reggaetón Viejo",
        blurb: "Reggaetón das antigas: Don Omar, Wisin & Yandel, Arcángel.",
      },
      decades: { name: "Sucessos de todas as décadas", blurb: "Músicas que todo mundo conhece, dos anos 1960 até hoje." },
    },

    status: {
      addPlayers: (n) => `Adicione mais ${n} ${plural(n, "jogador", "jogadores")} para começar`,
      openRoom: "Abra a sala primeiro",
      waitingPlaylists: (n) => `Esperando mais ${n} ${plural(n, "playlist", "playlists")}`,
      phonesReady: (n) => `${n} ${plural(n, "celular pronto", "celulares prontos")}`,
      nobodyScanned: "Ninguém escaneou ainda — dá para começar mesmo assim",
    },

    room: {
      describe: (collectsPlaylists, buzzer, orderGame) => {
        const gets = orderGame ? "as cartas" : "uma campainha";
        if (collectsPlaylists && buzzer) {
          return `Um QR code faz as duas coisas — os jogadores escaneiam para adicionar uma playlist e receber ${gets}.`;
        }
        if (collectsPlaylists) return "Os jogadores escaneiam um QR code para adicionar a própria playlist.";
        return `Os jogadores escaneiam um QR code para receber ${gets} no celular.`;
      },
      yourName: "Seu nome",
      hostCanPlay: {
        guess: "Você também pode apertar a campainha nesta tela.",
        order: "Você também pode jogar nesta tela.",
      },
      opening: "Abrindo a sala...",
      open: "Abrir sala",
      shareTitle: (code) => `Entre na sala ${code} no GuessSong`,
      qrAlt: (code) => `QR code para entrar na sala ${code}`,
      linkCopied: "✓ Link copiado",
      shareLink: "Compartilhar link da sala",
      orSendLink: "Ou mande o link.",
      reconnect: "Reconectar",
      connecting: "Conectando à sala…",
      inTheRoom: (n) => `${n} na sala`,
      noPlaylistYet: " · sem playlist ainda",
      tracks: (n) => ` · ${n} ${plural(n, "música", "músicas")}`,
      away: " (ausente)",
      nobodyYetBuzzer: "Ninguém ainda — quem chegar atrasado pode entrar no meio do jogo.",
      nobodyYet: "Ninguém ainda.",
      hostPlaylistIn: (n, from) => `✓ Sua playlist entrou — ${n} ${plural(n, "música", "músicas")} de ${from}`,
      addYourOwn: "Adicione a sua playlist também.",
      adding: "Adicionando...",
      addMine: "Adicionar minha playlist",
      oneCodeBoth:
        "Um código faz as duas coisas — as playlists fecham quando o jogo começa, as campainhas continuam abertas.",
    },

    collector: {
      full: (max) => `${max} jogadores é o máximo — remova alguém para adicionar outro.`,
      added: (name) => `✓ A playlist de ${name} entrou`,
      passOn: "Passe o celular para o próximo jogador",
      next: "Próximo jogador →",
      yourName: "Seu nome",
      namePlaceholder: "Nome do jogador",
      nameTaken: "Esse nome já entrou — escolha outro.",
      yourPlaylist: "Sua playlist do Spotify",
      addAndPass: "Adicionar e passar o celular →",
      joined: (n) => `${n} ${plural(n, "jogador entrou", "jogadores entraram")}`,
      remove: (name) => `Remover ${name}`,
    },
  },
};

/** The `lang` attribute for a page rendered in `locale`. */
export function setupLang(locale: SetupLocale): string | undefined {
  return locale === "pt" ? "pt-BR" : undefined;
}
