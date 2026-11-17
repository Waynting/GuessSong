import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { SETUP_COPY, SETUP_LOCALES, COUNTED_SETUP_LOCALES, isCountedSetupLocale } from "@/lib/setup-copy";
import { rootLocaleFor } from "@/lib/accept-language";
import { ORDER_BLURB, orderSummary } from "@/lib/order-game";
import { STARTER_PLAYLISTS, THEME_CAPTION, fieldChipRow, starterCaption } from "@/lib/starter-playlists";
import { TEAM_NAMES } from "@/lib/teams";
import { challengeBanner } from "@/lib/challenge";
import { startState, type StartInputs } from "@/lib/start-status";
import { middleware, config } from "@/middleware";

/**
 * The Portuguese setup page (2026-11-17): one copy table for `/`, a second
 * prerendered route for it, and the middleware that picks between them.
 *
 * Read as source where the subject is a `.tsx` module — the suite cannot
 * import one here — and executed where it is not: the table, the header
 * parser and the middleware itself.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/** Every leaf path of a copy table, functions included, for comparing shapes. */
function leaves(value: unknown, prefix = ""): string[] {
  if (typeof value === "function" || typeof value === "string") return [prefix];
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, `${prefix}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

/** Every string a table can render, functions called with representative arguments. */
function rendered(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") {
    // Every parameterised entry takes numbers, a code/name, or the three room flags.
    const fn = value as (...args: unknown[]) => string;
    return [fn(1, "Ana"), fn(3, "Ana"), fn(true, true, true), fn(true, false, false), fn(false, true, false)].filter(
      (s): s is string => typeof s === "string"
    );
  }
  if (Array.isArray(value)) return value.flatMap(rendered);
  if (value && typeof value === "object") return Object.values(value).flatMap(rendered);
  return [];
}

describe("the setup copy table", () => {
  it("ships English and Portuguese, the same shape in each", () => {
    expect([...SETUP_LOCALES]).toEqual(["en", "pt"]);
    expect(leaves(SETUP_COPY.pt).sort()).toEqual(leaves(SETUP_COPY.en).sort());
    for (const locale of SETUP_LOCALES) {
      for (const text of rendered(SETUP_COPY[locale])) {
        expect(text.trim(), `${locale}: empty string`).not.toBe("");
      }
    }
  });

  it("is translated: no Portuguese entry is the English one, bar the few that are not words", () => {
    // Names that are ours in every language, an address, a duration, and a
    // word Portuguese borrowed whole.
    const same = new Set([
      "clipPill",
      "starters.party_hits.name",
      "starters.reggaeton.name",
      "chipRow.playlists",
    ]);
    const en = SETUP_COPY.en as unknown as Record<string, unknown>;
    const pt = SETUP_COPY.pt as unknown as Record<string, unknown>;
    const at = (root: Record<string, unknown>, path: string): unknown =>
      path.split(".").reduce<unknown>((node, key) => {
        const m = key.match(/^(\w+)\[(\d+)\]$/);
        if (m) return ((node as Record<string, unknown[]>)[m[1]] ?? [])[Number(m[2])];
        return (node as Record<string, unknown>)?.[key];
      }, root);
    for (const path of leaves(en)) {
      if (same.has(path)) continue;
      const a = rendered(at(en, path));
      const b = rendered(at(pt, path));
      expect(b, `${path} is untranslated`).not.toEqual(a);
    }
  });

  it("keeps the English byte-identical to what app/page.tsx said before the table", () => {
    const en = SETUP_COPY.en;
    // The button, and the line it shows while loading.
    expect(en.start).toBe("Start Game →");
    expect(en.loading).toBe("Loading playlist");
    // The three tiles and the question over them.
    expect(en.whoQuestion).toBe("Who's playing?");
    expect(en.who).toEqual({
      solo: { title: "Just me", sub: ORDER_BLURB },
      group: { title: "A group", sub: "Play a clip, everyone shouts the title." },
      mixed: { title: "Everyone's playlists", sub: "Everyone adds a playlist, guess whose song." },
    });
    expect(en.playlistLabel).toBe("Spotify Playlist, Album or Artist");
    expect(en.playlistPlaceholder).toBe("https://open.spotify.com/playlist/... or /album/... or /artist/...");
    expect(en.playerPlaceholder(1)).toBe("Player 1");
    expect(en.removePlayer(2)).toBe("Remove player 2");
    expect(en.addPlayer).toBe("Add Player");
    expect(en.guessBlurb).toBe("Play a clip, everyone shouts the title, you award the points.");
    expect(en.orderBlurb).toBe(ORDER_BLURB);
    expect(en.customAria(500)).toBe("Custom number of songs, 1 to 500");
    expect(en.summary.songsPerPlayer(5)).toBe("5 songs per player");
    expect(en.summary.songs(20)).toBe("20 songs");
    expect(en.settingsChange).toBe("Change ▾");
    expect(en.settingsDone).toBe("Done ▴");
    expect(en.quizCardSub).toBe("Make a Taste Quiz link for friends →");
    expect(en.faqs.map((f) => f.q)).toEqual([
      "How do you play the guess the song game?",
      "Do I need a Spotify account, and is it free?",
      "Can everyone use their own playlist?",
      "Which playlists work?",
    ]);
    expect(en.recall).toEqual({ line: "Filled in from your last game here.", startFresh: "Start fresh" });
    // The room card and pass-the-phone, which took their sentences from here too.
    expect(en.room.describe(true, true, false)).toBe(
      "One QR code does both — players scan it to add a playlist and get a buzzer."
    );
    expect(en.room.describe(false, true, true)).toBe("Players scan a QR code to get the cards on their phone.");
    expect(en.room.hostPlaylistIn(1, "Mix")).toBe("✓ Your playlist is in — 1 track from Mix");
    expect(en.room.inTheRoom(3)).toBe("3 in the room");
    expect(en.collector.added("Ana")).toBe("✓ Ana's playlist is in");
    expect(en.collector.joined(1)).toBe("1 player joined");
    expect(en.collector.addAndPass).toBe("Add & Pass Phone →");
  });

  it("agrees with the lib modules whose English it renders in another language", () => {
    for (const count of [1, 9, 20, "all"] as const) {
      expect(SETUP_COPY.en.summary.orderSongs(count)).toBe(orderSummary(count));
    }
    for (const n of [1, 2, 3]) expect(SETUP_COPY.en.starterCaption(n)).toBe(starterCaption(n));
    // The three setup surfaces main added beside the form (themes, teams, a
    // friend's challenge) say in English exactly what their lib modules say.
    expect(SETUP_COPY.en.themeCaption).toBe(THEME_CAPTION);
    expect(SETUP_COPY.en.teams.names).toEqual(TEAM_NAMES);
    expect(SETUP_COPY.en.teams.needTwo).toBe("2 a side needed");
    expect(SETUP_COPY.en.challengeBanner(7, 12)).toBe(challengeBanner(7, 12));
    expect(SETUP_COPY.pt.challengeBanner(7, 12)).toContain("7 de 12");
    for (const starter of STARTER_PLAYLISTS) {
      expect(SETUP_COPY.en.starters[starter.starterKey]).toEqual({ name: starter.name, blurb: starter.blurb });
    }
    // The chip row's three heads, by kind.
    const recent = [{ id: "a".repeat(22), name: "Mine" }];
    const decades = STARTER_PLAYLISTS.filter((s) => s.game === "order");
    for (const row of [
      fieldChipRow(recent, decades, null),
      fieldChipRow([], decades, "field"),
      fieldChipRow([], decades, "field", { themed: true }),
      fieldChipRow(recent, decades, "field"),
    ]) {
      expect(SETUP_COPY.en.chipRow[row.kind]).toBe(row.label);
    }
  });

  it("drives the line under Start in either language, English unchanged", () => {
    const base: StartInputs = {
      setupMode: "single",
      mixedSubMode: "room",
      busy: false,
      needsRoom: false,
      roomOpen: false,
      buzzerEnabled: true,
      buzzerPlayerCount: 0,
      mixedContributions: 0,
      roomSubmissions: 0,
    };
    expect(startState(base).status).toBe("Nobody has scanned yet — you can still start");
    expect(startState({ ...base, locale: "en" }).status).toBe("Nobody has scanned yet — you can still start");
    expect(startState({ ...base, locale: "pt" }).status).toBe(SETUP_COPY.pt.status.nobodyScanned);
    expect(startState({ ...base, buzzerPlayerCount: 2, locale: "pt" }).status).toBe("2 celulares prontos");
    expect(
      startState({ ...base, setupMode: "mixed", mixedSubMode: "phone", buzzerEnabled: false, locale: "pt" }).status
    ).toBe("Adicione mais 2 jogadores para começar");
  });

  it("names the games and the setting the way the Portuguese errors refer to them", () => {
    // `order_too_few_dated`, `order_dates_pending` and `order_count_too_small`
    // send the host to a pill and a setting by name.
    expect(SETUP_COPY.pt.guessPill).toBe("Adivinhe a música");
    expect(SETUP_COPY.pt.orderPill).toBe("Ponha em ordem");
    expect(SETUP_COPY.pt.songCountLabel).toBe("Número de músicas");
    expect(SETUP_COPY.pt.allPill).toBe("Todas");
  });

  it("leaves the hero <h2> out of the table, in English, on both pages", () => {
    // The phrase Google ranks `/` for; not to be touched without asking.
    const hero = "Play a clip, guess the song — free, for any Spotify playlist, no login.";
    const page = read("app/setup-page.tsx");
    expect(page.split(hero)).toHaveLength(2);
    expect(page).toMatch(/<h2\s+lang=\{pageLocale === "en" \? undefined : "en"\}/);
    expect(read("lib/setup-copy.ts")).not.toContain(hero);
    for (const locale of SETUP_LOCALES) {
      expect(rendered(SETUP_COPY[locale])).not.toContain(hero);
    }
  });

  it("leaves no English sentence typed into the page's markup", () => {
    // Every word a host reads on `/` comes from `copy`. What may stay a
    // literal: the brand, the hero line above, and the language switch.
    const page = read("app/setup-page.tsx");
    // From the render on, JSX comments out: they name tags in prose.
    const markup = page.slice(page.indexOf("  return (\n    <>")).replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    const prose = [...markup.matchAll(/>([^<>{}]*[A-Za-z]{3,}[^<>{}]*)</g)].map((m) => m[1].trim());
    expect(prose.sort()).toEqual(
      ["GuessSong", "Play a clip, guess the song — free, for any Spotify playlist, no login."].sort()
    );
    for (const attribute of ["placeholder", "aria-label", "label", "caption", "title", "alt"]) {
      const quoted = [...markup.matchAll(new RegExp(`\\s${attribute}="([^"]*)"`, "g"))].map((m) => m[1]);
      expect(quoted, attribute).toEqual([]);
    }
  });

  it("forces Portuguese errors and the Portuguese notice on the pt page only", () => {
    const page = read("app/setup-page.tsx");
    expect(page).toMatch(/const locale: ErrorLocale = pageLocale === "pt" \? "pt" : deviceLocale;/);
    expect(page).toMatch(/<ServiceNotice locale=\{pageLocale === "pt" \? "pt" : undefined\} \/>/);
    expect(page).toMatch(/<main\s+lang=\{setupLang\(pageLocale\)\}/);
    // The two components the page hands its language to.
    expect(page).toMatch(/<RoomPanel\s+locale=\{pageLocale\}/);
    expect(page).toMatch(/<MixedPlaylistCollector\s+locale=\{pageLocale\}/);
  });
});

describe("the game_started pulse's language", () => {
  it("counts pt only, from a closed set, and only the pt page sends it", () => {
    expect([...COUNTED_SETUP_LOCALES]).toEqual(["pt"]);
    expect(isCountedSetupLocale("pt")).toBe(true);
    for (const bad of ["en", "zh", "pt-BR", "", null, 1]) expect(isCountedSetupLocale(bad)).toBe(false);
    const page = read("app/setup-page.tsx");
    expect(page).toMatch(/\.\.\.\(pageLocale === "pt" \? \{ locale: pageLocale \} : \{\}\),/);
    expect(read("lib/loop-client.ts")).toMatch(/\.\.\.\(locale \? \{ locale \} : \{\}\),/);
  });
});

describe("rootLocaleFor", () => {
  it("reads Portuguese when it is the reader's top preference", () => {
    for (const header of [
      "pt-BR",
      "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "pt",
      "PT-br",
      "pt-PT,pt;q=0.9",
      "en;q=0.5, pt-BR;q=0.9",
      " pt-BR ; q=1 , en ; q=0.8",
    ]) {
      expect(rootLocaleFor(header), header).toBe("pt");
    }
  });

  it("serves English to everyone else — Googlebot, no header, and Portuguese as a second choice", () => {
    for (const header of [
      null,
      undefined,
      "",
      "en-US,en;q=0.9",
      "en-US,en;q=0.9,pt-BR;q=0.8",
      "es-419,es;q=0.9,pt;q=0.8",
      "pt;q=0",
      "ptx",
      "*",
      "en, pt",
      ",,;;",
      "pt-BR;q=abc",
      "x".repeat(10_000),
    ]) {
      expect(rootLocaleFor(header as string | null), String(header).slice(0, 40)).toBe("en");
    }
  });
});

describe("middleware.ts", () => {
  const request = (acceptLanguage?: string, path = "/") =>
    new NextRequest(`https://www.guessong.app${path}`, {
      headers: acceptLanguage ? { "accept-language": acceptLanguage } : {},
    });

  it("matches `/` and nothing else", () => {
    expect(config).toEqual({ matcher: ["/"] });
  });

  it("rewrites a Portuguese reader to /pt, keeping the query, and never redirects", () => {
    const res = middleware(request("pt-BR,pt;q=0.9", "/?playlist=https%3A%2F%2Fopen.spotify.com%2Fplaylist%2Fx"));
    const rewrite = res.headers.get("x-middleware-rewrite");
    expect(rewrite).not.toBeNull();
    const target = new URL(rewrite!);
    expect(target.pathname).toBe("/pt");
    expect(target.searchParams.get("playlist")).toBe("https://open.spotify.com/playlist/x");
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
    expect(res.headers.get("vary")).toBe("Accept-Language");
  });

  it("passes everyone else straight through to today's `/`, with the same Vary", () => {
    for (const header of [undefined, "en-US,en;q=0.9", "en-US,en;q=0.9,pt;q=0.8", "zh-TW"]) {
      const res = middleware(request(header));
      expect(res.headers.get("x-middleware-rewrite"), String(header)).toBeNull();
      expect(res.headers.get("x-middleware-next"), String(header)).toBe("1");
      expect(res.headers.get("location"), String(header)).toBeNull();
      expect(res.headers.get("vary"), String(header)).toBe("Accept-Language");
    }
  });

  it("imports nothing but next/server and the header parser", () => {
    // It runs on every request for `/`; whatever it imports rides that path.
    const imports = [...read("middleware.ts").matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports).toEqual(["next/server", "@/lib/accept-language"]);
    expect(read("lib/accept-language.ts")).not.toMatch(/^import /m);
  });
});

describe("the /pt route", () => {
  const pt = read("app/pt/page.tsx");

  it("is noindex, follow, with its canonical on `/`", () => {
    expect(pt).toMatch(/robots: \{ index: false, follow: true \}/);
    expect(pt).toMatch(/alternates: \{ canonical: "\/" \}/);
  });

  it("renders the same setup page in Portuguese, prerendered — no request-time reads", () => {
    expect(pt).toMatch(/return <SetupPage locale="pt" \/>;/);
    expect(read("app/page.tsx")).toMatch(/return <SetupPage locale="en" \/>;/);
    for (const source of [pt, read("app/page.tsx")]) {
      expect(source).not.toMatch(/headers\(\)|cookies\(\)|searchParams|force-dynamic|revalidate/);
      expect(source).not.toMatch(/"use client"/);
    }
  });

  it("is neither disallowed (a crawler must read the noindex) nor in the sitemap", () => {
    expect(read("app/robots.ts")).not.toMatch(/["']\/pt/);
    expect(read("app/sitemap.ts")).not.toMatch(/["'`]\/pt/);
  });
});
