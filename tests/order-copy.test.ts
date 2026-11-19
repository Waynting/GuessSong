import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ORDER_COPY, ORDER_LOCALES, orderLang, orderLocaleOf } from "@/lib/order-copy";
import { SETUP_COPY } from "@/lib/setup-copy";
import { TEAM_NAMES } from "@/lib/teams";
import { MIXED_NEXT_GAME_LABEL } from "@/lib/game-over";
import { LOOP_QR_CAPTION } from "@/lib/loop-links";
import { buildGamePayload, gameLocaleFor, isGameLocale, parseGamePayload } from "@/lib/game-session";
import { decadeLabel, musicAge, musicAgeCopy } from "@/lib/music-age";
import { orderLeftoverLine } from "@/lib/order-game";
import { streakLine } from "@/lib/streak";
import { challengeButtonLabel, challengeResultLine, challengeShareText } from "@/lib/challenge";

/**
 * The order page in the language of the setup page that started it
 * (2026-11-19): 27% of games start on the Portuguese setup page, most of
 * them this game, and the page they landed on was English.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/** Every leaf path of a copy table, functions included, for comparing shapes. */
function leaves(value: unknown, prefix = ""): string[] {
  if (typeof value === "function" || typeof value === "string") return [prefix];
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

function at(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], root);
}

/** What a leaf renders, functions called with representative arguments. */
function render(value: unknown): string {
  if (typeof value === "string") return value;
  const fn = value as (...args: unknown[]) => string;
  // Every parameterised entry takes numbers, a name/code, or a list of names.
  const tries: unknown[][] = [[2, 4, true], ["Ana", 2, 4], [["Ana", "Bia"]], [3, "Ana"]];
  return tries
    .map((args) => {
      try {
        return String(fn(...args));
      } catch {
        return "";
      }
    })
    .join(" | ");
}

describe("the order copy table", () => {
  it("ships English and Portuguese, the same shape in each, nothing empty", () => {
    expect([...ORDER_LOCALES]).toEqual(["en", "pt"]);
    expect(leaves(ORDER_COPY.pt).sort()).toEqual(leaves(ORDER_COPY.en).sort());
    for (const locale of ORDER_LOCALES) {
      for (const path of leaves(ORDER_COPY[locale])) {
        expect(render(at(ORDER_COPY[locale], path)).trim(), `${locale}.${path}`).not.toBe("");
      }
    }
  });

  it("is translated: no Portuguese entry renders the English one, bar the few that are not words", () => {
    // Points and an arrow, and the abbreviation Brazilian scoreboards use too.
    // "vs" is said as-is in Brazil; its rendering differs by the team names.
    const same = new Set(["pts", "result.awarded", "result.oldestAwarded", "teams.vs"]);
    for (const path of leaves(ORDER_COPY.en)) {
      if (same.has(path)) continue;
      expect(render(at(ORDER_COPY.pt, path)), path).not.toBe(render(at(ORDER_COPY.en, path)));
    }
    for (const path of same) {
      expect(render(at(ORDER_COPY.pt, path)), path).toBe(render(at(ORDER_COPY.en, path)));
    }
  });

  it("keeps English byte-identical to what the page said before the table", () => {
    const en = ORDER_COPY.en;
    expect(en.round).toBe("Round");
    expect(en.endGame).toBe("End Game");
    expect(en.reveal).toBe("Reveal the Years →");
    expect(en.nextRound).toBe("Next Round →");
    expect(en.seeFinalScores).toBe("See Final Scores →");
    expect(en.prompt.revealed).toBe("Oldest to newest — the real order");
    expect(en.prompt.solo).toBe("Oldest on top. Drag the cards into order, then reveal");
    expect(en.result.untouched).toBe("Left as dealt — drag the cards next round to score.");
    expect(en.result.partial(2, 4, false)).toBe("2 of 4 in the right place · oldest ✗");
    expect(en.result.fullOrderMissed(3)).toBe("Full order +3 — not this time");
    expect(en.result.whoCalled(3)).toBe("Who called the full order? (+3 pts)");
    expect(en.gameOver).toBe("Game Over");
    expect(en.finalScores).toBe("Final Scores");
    expect(en.playAgain).toBe("Play Again →");
    expect(en.saveResults).toBe("Save Results");
    expect(en.cardAria("Hey Jude", 2, 4)).toBe("Hey Jude, position 2 of 4. Arrow keys move it.");
    expect(en.fromPlaylists(["Ana"])).toBe("Ana's playlist");
    expect(en.fromPlaylists(["Ana", "Bia"])).toBe("Ana & Bia's playlists");
    expect(en.room.lockedIn("ABCD", 1, 3)).toBe("Room ABCD · 1 of 3 phones locked in");
    // Shared constants, read rather than re-typed.
    expect(en.mixedNextGame).toBe(MIXED_NEXT_GAME_LABEL);
    expect(en.qrCaption).toBe(LOOP_QR_CAPTION);
    expect(en.teams.names).toEqual(TEAM_NAMES);
  });

  it("speaks the Portuguese setup page's vocabulary", () => {
    const pt = ORDER_COPY.pt;
    expect(pt.teams.names).toEqual(SETUP_COPY.pt.teams.names);
    expect(pt.teams.names).toEqual({ a: "Time A", b: "Time B" });
    expect(pt.round).toBe("Rodada");
    expect(pt.reveal).toBe("Revelar os anos →");
    expect(pt.nextRound).toBe("Próxima rodada →");
    expect(pt.gameOver).toBe("Fim de jogo");
    expect(pt.playAgain).toBe("Jogar de novo →");
    // The buttons that sit on one line at 390px stay about the English length.
    for (const key of ["reveal", "nextRound", "seeFinalScores", "endGame", "playAgain"] as const) {
      expect(pt[key].length, key).toBeLessThanOrEqual(ORDER_COPY.en[key].length + 4);
    }
  });

  it("reads absent (or anything but pt) as English, and pt-BR for the lang attribute", () => {
    expect(orderLocaleOf(undefined)).toBe("en");
    expect(orderLocaleOf("pt")).toBe("pt");
    expect(orderLang("pt")).toBe("pt-BR");
    expect(orderLang("en")).toBeUndefined();
  });
});

describe("the payload carries the setup page's language", () => {
  const base = {
    tracks: [{ id: "t1", name: "Song", artists: ["A"], durationMs: 1000, createdAt: "2026-11-19" }],
    players: [{ name: "Ana", score: 0 }],
    playlistName: "P",
    clipDuration: 15,
    playlistSource: "own" as const,
    mode: "order" as const,
  };

  it("sets locale only for the Portuguese page", () => {
    expect(gameLocaleFor("pt")).toBe("pt");
    expect(gameLocaleFor("en")).toBeUndefined();
    expect(buildGamePayload({ ...base, locale: gameLocaleFor("pt") }).locale).toBe("pt");
    expect("locale" in buildGamePayload({ ...base, locale: gameLocaleFor("en") })).toBe(false);
    expect(isGameLocale("en")).toBe(false);
  });

  it("round-trips pt, reads an old payload as English, and repairs a junk value to absent", () => {
    const pt = parseGamePayload(JSON.stringify(buildGamePayload({ ...base, locale: "pt" })));
    expect(pt?.locale).toBe("pt");
    const old = parseGamePayload(JSON.stringify(buildGamePayload(base)));
    expect(old).not.toBeNull();
    expect(old && "locale" in old).toBe(false);
    for (const junk of ["en", "pt-BR", "PT", 1, null, { pt: true }]) {
      const parsed = parseGamePayload(JSON.stringify({ ...buildGamePayload(base), locale: junk }));
      expect(parsed, String(junk)).not.toBeNull();
      expect(parsed && "locale" in parsed, String(junk)).toBe(false);
      expect(parsed?.tracks).toHaveLength(1);
    }
  });

  it("is written by every start path of the setup page, from its locale prop", () => {
    const page = read("app/setup-page.tsx");
    const builds = page.match(/buildGamePayload\(\{[\s\S]*?\n {6}\}\);/g) ?? [];
    expect(builds).toHaveLength(3);
    for (const build of builds) expect(build).toMatch(/locale: gameLocaleFor\(pageLocale\),/);
  });
});

describe("the order page reads the table", () => {
  const page = read("app/order/page.tsx");

  it("takes its language from the payload, and forces Portuguese errors for a pt game", () => {
    expect(page).toMatch(/setPageLocale\(orderLocaleOf\(data\.locale\)\);/);
    expect(page).toMatch(/const copy = ORDER_COPY\[pageLocale\];/);
    expect(page).toMatch(/const locale = pageLocale === "pt" \? "pt" : deviceLocale;/);
    expect(page).toMatch(/buzzerErrorMessage\(room\.error, locale, "host"\)/);
    expect(page).toMatch(/<div className="game-layout" lang=\{orderLang\(pageLocale\)\}>/);
  });

  it("hands its language to every lib line and component it renders", () => {
    expect(page).toMatch(/orderLeftoverLine\(leftover, pageLocale\)/);
    expect(page).toMatch(/streakLine\(streakResult, playlistName, pageLocale\)/);
    expect(page).toMatch(/<MusicAgeCard age=\{ears\} room=\{!solo\} locale=\{pageLocale\} \/>/);
    expect(page).toMatch(/<TeamGameOver players=\{players\} locale=\{pageLocale\} \/>/);
    expect(page).toMatch(/<TeamScoreList players=\{players\} scorePulse=\{scorePulse\} locale=\{pageLocale\} \/>/);
    expect(page).toMatch(/<OrderChallenge[\s\S]*?locale=\{pageLocale\}[\s\S]*?\/>/);
    expect(page).toMatch(/<LoopQr caption=\{copy\.qrCaption\} \/>/);
  });

  it("leaves no English sentence typed into the page's markup", () => {
    // From the loading screen on, without the stylesheet and JSX comments.
    const markup = page
      .slice(page.indexOf("  if (rounds.length === 0) {"))
      .replace(/<style>\{`[\s\S]*?`\}<\/style>/, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    const prose = [...markup.matchAll(/>([^<>{}]*[A-Za-z]{2,}[^<>{}]*)</g)].map((m) => m[1].trim())
      // Text between a `>` and a `<` that is code (an arrow's `=>`, the
      // tail of a ternary), not prose.
      .filter((t) => !/[;=]/.test(t) && !t.startsWith(")") && !t.endsWith("(") && !/\w\.\w+\(/.test(t));
    expect(prose).toEqual([]);
    for (const attribute of ["placeholder", "aria-label", "label", "caption", "title", "alt"]) {
      const quoted = [...markup.matchAll(new RegExp(`\\s${attribute}="([^"]*)"`, "g"))].map((m) => m[1]);
      expect(quoted.filter((q) => q !== ""), attribute).toEqual([]);
    }
    // No quoted or template string of words inside a JSX expression either
    // ("not this time", `${n} of ${total}`), class lists and comments aside.
    const code = markup
      .replace(/className="[^"]*"/g, "")
      .replace(/className=\{`[^`]*`\}/g, "")
      .replace(/className=\{[^}]*\}/g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const strings = [...code.matchAll(/"([^"\n]*)"|`([^`\n]*)`/g)]
      .map((m) => m[1] ?? m[2])
      .filter((s) => /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(s) || /^[A-Z][a-z]+/.test(s));
    // The loading screen's font stack is the one capitalised string left.
    expect(strings).toEqual(["Outfit, sans-serif"]);
  });

  it("keeps the saved result image English, as stated in lib/order-copy.ts", () => {
    expect(page).toMatch(/title: "Final Scores",/);
    expect(read("lib/order-copy.ts")).toMatch(/result image[\s\S]*stays English/);
  });
});

describe("the lib lines the order page renders", () => {
  it("names a decade in Portuguese", () => {
    expect(decadeLabel(1987, "pt")).toBe("o fim dos anos 80");
    expect(decadeLabel(1983, "pt")).toBe("o começo dos anos 80");
    expect(decadeLabel(1995, "pt")).toBe("o meio dos anos 90");
    expect(decadeLabel(2003, "pt")).toBe("o começo dos anos 2000");
    expect(decadeLabel(2018, "pt")).toBe("o fim dos anos 2010");
    expect(decadeLabel(1905, "pt")).toBe("o meio dos anos 1900");
    // English untouched.
    expect(decadeLabel(1987)).toBe("the late '80s");
  });

  it("writes the music age card in Portuguese, the decade contracted after 'em'", () => {
    const age = musicAge([{ verdict: "exact", tracks: [{ releaseDate: "1987-01-01" }] }], new Date("2026-11-19"));
    expect(age).not.toBeNull();
    const solo = musicAgeCopy(age!, false, "pt");
    expect(solo.headline).toBe("Seus ouvidos vivem em 1987");
    expect(solo.line).toBe("Em algum lugar no fim dos anos 80, pelas rodadas que você acertou.");
    expect(solo.shareText).toContain("(o fim dos anos 80)");
    expect(musicAgeCopy(age!, true, "pt").headline).toBe("Os ouvidos desta sala vivem em 1987");
    expect(musicAgeCopy(age!, false).headline).toBe("Your ears live in 1987");
    expect(musicAgeCopy(age!, false).copied).toBe("Link copied ✓");
  });

  it("translates the leftover note, the streak line and the challenge card", () => {
    expect(orderLeftoverLine(1, "pt")).toMatch(/^1 música ficou de fora/);
    expect(orderLeftoverLine(3, "pt")).toMatch(/^3 músicas ficaram de fora/);
    expect(orderLeftoverLine(0, "pt")).toBeNull();
    expect(streakLine({ streak: 1, band: "d1", best: null }, "Decades", "pt")).toBe(
      "Dia 1 — volte amanhã para começar uma sequência"
    );
    expect(
      streakLine({ streak: 3, band: "d3_6", best: { outcome: "new", score: 9, best: 9, previous: 7 } }, "Decades", "pt")
    ).toBe("🔥 3 dias seguidos · Recorde em Decades: 9 — novo recorde!");
    expect(challengeResultLine(9, 7, "pt")).toBe("Você 9 · Seu amigo 7 — você venceu!");
    expect(challengeButtonLabel(9, false, "pt")).toBe("Desafie um amigo: supere meus 9");
    expect(challengeShareText(9, 12, "pt")).toMatch(/9 de 12/);
  });

  it("hands the components their language", () => {
    expect(read("components/music-age.tsx")).toMatch(/musicAgeCopy\(age, room, locale\)/);
    const challenge = read("components/order-challenge.tsx");
    expect(challenge).toMatch(/const copy = ORDER_COPY\[locale\]\.challenge;/);
    expect(challenge).toMatch(/challengeResultLine\(deal\.score, against\.score, locale\)/);
    expect(challenge).toMatch(/challengeShareText\(deal\.score, deal\.max, locale\)/);
    const teams = read("components/team-scoreboard.tsx");
    expect(teams).not.toMatch(/TEAM_NAMES|"It's a tie"|"pts each"/);
    expect(read("components/loop-qr.tsx")).toMatch(/\{caption\}/);
  });
});

describe("the phone rules still hold", () => {
  it("keeps the one-line slots shrinkable, so a longer Portuguese label cannot widen the column", () => {
    const page = read("app/order/page.tsx");
    expect(page).toMatch(/grid-template-columns: minmax\(0, 1fr\) 300px;/);
    expect(page).toMatch(/\.playlist-name \{[^}]*min-width: 0;[^}]*text-overflow: ellipsis;/);
    expect(page).toMatch(/\.round-badge, \.end-game-btn \{ flex-shrink: 0; \}/);
  });
});
