// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePulse } from "@/lib/pulse";
import { isDeterministicPlaylistFailure } from "@/lib/error-messages";
import { PLAYLIST_REFUSAL_CODES } from "@/lib/loop-stats";
import { isEditorialId, isPlaylistId } from "@/lib/playlist-ref";
import {
  STARTER_KEYS,
  STARTER_PLAYLISTS,
  fieldChipRow,
  isStarterKey,
  starterCaption,
  starterKeyForId,
  starterPlacement,
  startersFor,
  orderByMarket,
  regionFromLanguages,
  themeRowFor,
  THEME_CAPTION,
  THEME_LABEL_MAX,
  THEME_ROW_MIN,
  type StarterContext,
  type StarterPlaylist,
} from "@/lib/starter-playlists";

const kv = vi.hoisted(() => ({ incrs: [] as string[] }));

vi.mock("@/lib/kv", () => ({
  dayBucket: () => "2026-11-17",
  getKvStore: async () => ({
    async incr(key: string) {
      kv.incrs.push(key);
      return 1;
    },
  }),
}));

const { recordStarterThemeRow, __resetLivenessForTests } = await import("@/lib/loop-stats");

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * The starter playlists.
 *
 * Two things are pinned. The rule for where starters are offered is tested
 * against a fixture, so it does not move when the real list does. And the
 * real list is checked entry by entry.
 */

const FIXTURE: readonly StarterPlaylist[] = [
  { id: "3cEYpjA9oz9GiPac4AsH4n", starterKey: "party_hits", game: "guess", name: "Party Hits", blurb: "Songs everyone knows" },
  { id: "5FJXhjdILmRA2z5bvz4nzf", starterKey: "reggaeton", game: "guess", name: "90s Rock", blurb: "Guitars, mostly" },
];
const ORDER_FIXTURE: readonly StarterPlaylist[] = [
  { id: "1AbCdEfGhIjKlMnOpQrStU", starterKey: "decades", game: "order", name: "Every decade", blurb: "1960s to now" },
];

/**
 * Three themed order lists, as the owner's packs will look: the keys are
 * borrowed from STARTER_KEYS (the type insists), the ids are made up and
 * never ship.
 */
const THEMED: readonly StarterPlaylist[] = [
  {
    id: "1AbCdEfGhIjKlMnOpQrStU", starterKey: "decades", game: "order", name: "Every decade", blurb: "1960s to now",
    theme: { label: "Every decade", emoji: "📅" },
  },
  {
    id: "2AbCdEfGhIjKlMnOpQrStU", starterKey: "party_hits", game: "order", name: "Hits of the 80s", blurb: "Synths",
    theme: { label: "80s", emoji: "📼", markets: ["US", "GB"] },
  },
  {
    id: "3AbCdEfGhIjKlMnOpQrStU", starterKey: "reggaeton", game: "order", name: "Sertanejo", blurb: "Brazil",
    theme: { label: "Sertanejo", markets: ["BR", "PT"] },
  },
];

/** A first visit: Single Playlist, the guess game, nothing typed, nothing remembered, no error. */
function context(over: Partial<StarterContext> = {}): StarterContext {
  return {
    starters: FIXTURE,
    playStyle: "guess",
    singleMode: true,
    fieldEmpty: true,
    recentCount: 0,
    failureCode: null,
    ...over,
  };
}

/** The order style, with its own list: the form a "Just me" host sees. */
function orderContext(over: Partial<StarterContext> = {}): StarterContext {
  return context({ starters: ORDER_FIXTURE, playStyle: "order", ...over });
}

describe("the list as it ships", () => {
  it("is not empty", () => {
    // Filled on 2026-10-01; the checks below are what hold each entry.
    expect(STARTER_PLAYLISTS.length).toBeGreaterThan(0);
  });

  it("holds only ids that could load: 22 characters of base62, and none of Spotify's own", () => {
    for (const { id, name } of STARTER_PLAYLISTS) {
      expect(isPlaylistId(id), `${name}: "${id}" is not a playlist id`).toBe(true);
      expect(id, `${name}: "${id}" is not 22 characters of base62`).toMatch(/^[A-Za-z0-9]{22}$/);
      // 37i9… is refused for every app like this one, every time. Offering
      // one to a host with no playlist is offering them the refusal.
      expect(id.startsWith("37i9"), `${name} is one of Spotify's own playlists`).toBe(false);
      expect(isEditorialId(id), name).toBe(false);
    }
  });

  it("lists no playlist twice, and gives each a name and a blurb", () => {
    const ids = STARTER_PLAYLISTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { id, name, blurb } of STARTER_PLAYLISTS) {
      expect(name.trim().length, id).toBeGreaterThan(0);
      expect(blurb.trim().length, id).toBeGreaterThan(0);
      expect(name, id).toBe(name.trim());
      expect(blurb, id).toBe(blurb.trim());
    }
  });

  it("names each with a key from STARTER_KEYS, once, and gives each game at least one list", () => {
    // The key is what the counter is written under (host_setup_starter:<key>)
    // and what GA4's starter_key carries; the game is what partitions the
    // offer, so the order style never loses its chips to a guess list.
    const keys = STARTER_PLAYLISTS.map((p) => p.starterKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(isStarterKey(key), key).toBe(true);
    expect([...STARTER_KEYS]).toEqual(["party_hits", "reggaeton", "decades"]);
    expect(startersFor("guess").length).toBeGreaterThan(0);
    expect(startersFor("order").length).toBeGreaterThan(0);
    // The order game's list: 375 dated songs over 62 years on 2026-11-10.
    expect(startersFor("order").map((p) => p.starterKey)).toEqual(["decades"]);
    expect(startersFor("order")[0].id).toBe("0RRc1JAhWKFm7QSWGiI5y8");
  });

  it("declares no key without a list: a key nobody can pick is a counter that never moves", () => {
    // Adding a theme is one key and one entry, together (the file's header).
    const used = new Set(STARTER_PLAYLISTS.map((p) => p.starterKey));
    for (const key of STARTER_KEYS) expect(used.has(key), `${key} has no entry`).toBe(true);
  });

  it("gives each themed entry a short trimmed label, at most one emoji's worth, and real market codes", () => {
    for (const { id, theme } of [...STARTER_PLAYLISTS, ...THEMED]) {
      if (!theme) continue;
      expect(theme.label, id).toBe(theme.label.trim());
      expect(theme.label.length, id).toBeGreaterThan(0);
      expect([...theme.label].length, id).toBeLessThanOrEqual(THEME_LABEL_MAX);
      if (theme.emoji !== undefined) {
        expect(theme.emoji.trim().length, id).toBeGreaterThan(0);
        expect(/[A-Za-z0-9\s]/.test(theme.emoji), `${id}: emoji holds text`).toBe(false);
        expect([...theme.emoji].length, id).toBeLessThanOrEqual(4);
      }
      for (const market of theme.markets ?? []) expect(market, id).toMatch(/^[A-Z]{2}$/);
      expect(new Set(theme.markets ?? []).size, id).toBe((theme.markets ?? []).length);
    }
  });

  it("holds the fixture to the same rules, so the checks above are known to bite", () => {
    for (const { id } of [...FIXTURE, ...ORDER_FIXTURE]) {
      expect(isPlaylistId(id)).toBe(true);
      expect(isEditorialId(id)).toBe(false);
    }
    expect(isPlaylistId("37i9dQZF1DXcBWIGoYBM5M")).toBe(true);
    expect(isEditorialId("37i9dQZF1DXcBWIGoYBM5M")).toBe(true);
    expect(isPlaylistId("not-an-id")).toBe(false);
  });
});

describe("with the list empty, nothing is offered anywhere", () => {
  it("returns null for every state the page can be in, in either style", () => {
    for (const playStyle of ["guess", "order"] as const) {
      for (const singleMode of [true, false]) {
        for (const fieldEmpty of [true, false]) {
          for (const recentCount of [0, 1, 5]) {
            for (const failureCode of [null, "playlist_not_found", "playlist_editorial", "spotify_rate_limited", "order_too_few_dated"]) {
              const state = { playStyle, singleMode, fieldEmpty, recentCount, failureCode };
              expect(starterPlacement({ ...state, starters: [] }), JSON.stringify(state)).toBeNull();
            }
          }
        }
      }
    }
  });
});

describe("startersFor partitions the list by game", () => {
  const both = [...FIXTURE, ...ORDER_FIXTURE];
  it("hands each style its own entries and never the other's", () => {
    expect(startersFor("guess", both)).toEqual(FIXTURE);
    expect(startersFor("order", both)).toEqual(ORDER_FIXTURE);
    expect(startersFor("order", FIXTURE)).toEqual([]);
  });
});

describe("in the order style, the starter is for the returning host", () => {
  it("is offered beside the field whatever is in it and whatever the device remembers", () => {
    // `restored` was the largest round-zero source (~145/day): the host it is
    // for has a filled field and recent chips. A deliberate departure from
    // the guess game's rule, for this style only.
    expect(starterPlacement(orderContext())).toBe("field");
    expect(starterPlacement(orderContext({ fieldEmpty: false }))).toBe("field");
    expect(starterPlacement(orderContext({ recentCount: 3 }))).toBe("field");
    expect(starterPlacement(orderContext({ fieldEmpty: false, recentCount: 5 }))).toBe("field");
  });

  it("answers order_too_few_dated under the box, and leaves order_dates_pending to clear by itself", () => {
    expect(starterPlacement(orderContext({ fieldEmpty: false, failureCode: "order_too_few_dated" }))).toBe("refusal");
    expect(starterPlacement(orderContext({ fieldEmpty: false, failureCode: "order_dates_pending" }))).toBe("field");
    // The link's own permanent refusals still win the slot.
    expect(starterPlacement(orderContext({ fieldEmpty: false, failureCode: "playlist_not_found" }))).toBe("refusal");
  });

  it("never offers the guess game's lists, and is still never offered in Mixed mode", () => {
    expect(starterPlacement(orderContext({ starters: startersFor("order", FIXTURE) }))).toBeNull();
    expect(starterPlacement(orderContext({ singleMode: false }))).toBeNull();
  });

  it("leaves the guess style's rule exactly as it was", () => {
    expect(starterPlacement(context({ fieldEmpty: false }))).toBeNull();
    expect(starterPlacement(context({ recentCount: 1 }))).toBeNull();
    expect(starterPlacement(context({ failureCode: "order_too_few_dated", fieldEmpty: false }))).toBeNull();
  });
});

describe("the row under the field", () => {
  const recent = [
    { id: "5FJXhjdILmRA2z5bvz4nzf", name: "90s Rock" }, // also the second starter
    { id: "7axyIwzJZsCS6M9PlwQp1U", name: "Road trip" },
  ];

  it("is the recent chips alone when the starters go elsewhere", () => {
    for (const place of [null, "refusal"] as const) {
      const row = fieldChipRow(recent, FIXTURE, place);
      expect(row.playlists).toEqual(recent);
      expect(row.starterIds.size).toBe(0);
      expect(row.caption).toBeNull();
      expect(row.label).toBe("Recent");
    }
  });

  it("puts the starters after the recents, once each — a recent entry wins the id — and names which are starters", () => {
    const row = fieldChipRow(recent, FIXTURE, "field");
    expect(row.playlists.map((p) => p.id)).toEqual([
      "5FJXhjdILmRA2z5bvz4nzf",
      "7axyIwzJZsCS6M9PlwQp1U",
      "3cEYpjA9oz9GiPac4AsH4n",
    ]);
    expect(row.playlists[0]).toEqual(recent[0]); // the recent spelling, not the starter's
    expect([...row.starterIds]).toEqual(["3cEYpjA9oz9GiPac4AsH4n"]);
    expect(row.caption).toBeNull();
    expect(row.label).toBe("Playlists");
  });

  it("is the starters with their sentence when there is nothing else — exactly what a first visit saw before", () => {
    const row = fieldChipRow([], FIXTURE, "field");
    expect(row.playlists).toEqual(FIXTURE);
    expect(row.caption).toBe("No playlist handy? Try one of these");
    expect(row.label).toBe("Starter playlists");
    // One chip under "try one of these" reads as a fragment.
    expect(fieldChipRow([], ORDER_FIXTURE, "field").caption).toBe("No playlist handy? Start with ours");
    expect(starterCaption(1)).toBe("No playlist handy? Start with ours");
    expect(starterCaption(2)).toBe("No playlist handy? Try one of these");
  });
});

describe("starterKeyForId", () => {
  it("names the list in the field by any route, as a ref compared with a ref", () => {
    // What the field holds is a playable ref (lib/playlist-ref.ts): a
    // playlist's bare id. Each starter's is built the same way, so an album
    // starter one day compares album:<id> with album:<id>.
    expect(starterKeyForId("3cEYpjA9oz9GiPac4AsH4n", FIXTURE)).toBe("party_hits");
    expect(starterKeyForId("5FJXhjdILmRA2z5bvz4nzf", FIXTURE)).toBe("reggaeton");
    expect(starterKeyForId("1AbCdEfGhIjKlMnOpQrStU", [...FIXTURE, ...ORDER_FIXTURE])).toBe("decades");
    expect(starterKeyForId("0RRc1JAhWKFm7QSWGiI5y8")).toBe("decades");
    expect(starterKeyForId("7axyIwzJZsCS6M9PlwQp1U", FIXTURE)).toBeNull();
    expect(starterKeyForId("album:3cEYpjA9oz9GiPac4AsH4n", FIXTURE)).toBeNull();
    expect(starterKeyForId(null, FIXTURE)).toBeNull();
    expect(starterKeyForId("", FIXTURE)).toBeNull();
  });
});

describe("with a list, under the field", () => {
  it("offers them to a visitor with an empty field and no playlists of their own", () => {
    expect(starterPlacement(context())).toBe("field");
  });

  it("steps aside once anything is in the field", () => {
    expect(starterPlacement(context({ fieldEmpty: false }))).toBeNull();
  });

  it("steps aside for the recent chips — a returning host has playlists of their own", () => {
    expect(starterPlacement(context({ recentCount: 1 }))).toBeNull();
    expect(starterPlacement(context({ recentCount: 5 }))).toBeNull();
  });

  it("is not offered in Mixed mode, which has no field to fill", () => {
    expect(starterPlacement(context({ singleMode: false }))).toBeNull();
    expect(starterPlacement(context({ singleMode: false, failureCode: "playlist_not_found" }))).toBeNull();
  });
});

describe("with a list, under a refusal", () => {
  it("offers them for each refusal that will never change", () => {
    for (const failureCode of PLAYLIST_REFUSAL_CODES) {
      expect(starterPlacement(context({ fieldEmpty: false, failureCode })), failureCode).toBe("refusal");
    }
  });

  it("offers them there whether or not the device has recent playlists", () => {
    // The link the host wanted has just been refused. What they played last
    // month is under the field already; this is the other way forward.
    expect(
      starterPlacement(context({ fieldEmpty: false, recentCount: 3, failureCode: "playlist_editorial" }))
    ).toBe("refusal");
  });

  it("never offers them to a host whose playlist was fine", () => {
    // "Try one of these" under a throttling message says the link was the
    // problem. It was not, and the playlist they have will load in a minute.
    for (const failureCode of [
      "spotify_rate_limited",
      "spotify_cooldown",
      "spotify_quota_exhausted",
      "spotify_daily_budget_spent",
      "spotify_busy",
      "rate_limited_playlist",
      "playlist_load_failed",
      "storage_blocked",
      "players_required",
      "server_error",
      "unknown",
      "not_a_code",
      "constructor",
    ]) {
      expect(starterPlacement(context({ fieldEmpty: false, failureCode })), failureCode).toBeNull();
    }
  });

  it("does not answer an empty field's own error with a list under the box", () => {
    // `playlist_url_required` is deterministic, and is not a refusal of any
    // link: nothing was pasted. The offer belongs under the field, where the
    // empty-field rule already puts it.
    expect(isDeterministicPlaylistFailure("playlist_url_required")).toBe(true);
    expect(starterPlacement(context({ failureCode: "playlist_url_required" }))).toBe("field");
    expect(starterPlacement(context({ failureCode: "playlist_url_required", recentCount: 2 }))).toBeNull();
  });

  it("puts them in one place at a time, and the refusal wins", () => {
    // A host can clear the field with the error still up, which makes both
    // conditions true. The box is the one they are reading.
    expect(starterPlacement(context({ fieldEmpty: true, failureCode: "playlist_not_found" }))).toBe("refusal");
  });
});

describe("the device's region, for ordering themes only", () => {
  it("reads the first tag that names a region, and nothing from one that does not", () => {
    expect(regionFromLanguages(["pt-BR", "en-US"])).toBe("BR");
    expect(regionFromLanguages(["en", "pl-PL"])).toBe("PL");
    expect(regionFromLanguages(["zh-Hant-TW"])).toBe("TW");
    expect(regionFromLanguages(["es_mx"])).toBe("MX");
    expect(regionFromLanguages(["es-419"])).toBeNull(); // a UN region, not a country
    expect(regionFromLanguages(["en"])).toBeNull();
    expect(regionFromLanguages([])).toBeNull();
    expect(regionFromLanguages(null)).toBeNull();
    expect(regionFromLanguages(undefined)).toBeNull();
    expect(regionFromLanguages([42, "x-BRAZIL", "fr-CA"])).toBe("CA");
  });
});

describe("market ordering", () => {
  it("puts the region's themes first and keeps every theme — the hint orders, it never hides", () => {
    expect(orderByMarket(THEMED, "BR").map((s) => s.id)).toEqual([THEMED[2].id, THEMED[0].id, THEMED[1].id]);
    expect(orderByMarket(THEMED, "gb").map((s) => s.id)).toEqual([THEMED[1].id, THEMED[0].id, THEMED[2].id]);
    for (const region of [null, "JP", "BR", "US"]) {
      const ordered = orderByMarket(THEMED, region);
      expect(ordered).toHaveLength(THEMED.length);
      expect(new Set(ordered)).toEqual(new Set(THEMED));
    }
  });

  it("leaves the list's own order alone with no region, or one no theme names", () => {
    expect(orderByMarket(THEMED, null)).toEqual(THEMED);
    expect(orderByMarket(THEMED, "JP")).toEqual(THEMED);
    expect(orderByMarket(FIXTURE, "BR")).toEqual(FIXTURE);
  });
});

describe("the theme row", () => {
  it("appears only once a style has two themed starters", () => {
    expect(THEME_ROW_MIN).toBe(2);
    expect(themeRowFor(THEMED, null)).not.toBeNull();
    expect(themeRowFor(THEMED.slice(0, 2), null)).not.toBeNull();
    // One themed starter, or two untitled ones, is the old presentation.
    expect(themeRowFor(THEMED.slice(0, 1), null)).toBeNull();
    expect(themeRowFor(FIXTURE, null)).toBeNull();
    expect(themeRowFor([...FIXTURE, THEMED[1]], null)).toBeNull();
    expect(themeRowFor([], "BR")).toBeNull();
  });

  it("draws each as emoji and label, in market order, with the key it came from", () => {
    expect(themeRowFor(THEMED, "BR")).toEqual([
      { id: THEMED[2].id, name: "Sertanejo", starterKey: "reggaeton" },
      { id: THEMED[0].id, name: "📅 Every decade", starterKey: "decades" },
      { id: THEMED[1].id, name: "📼 80s", starterKey: "party_hits" },
    ]);
    // An untitled starter in a themed style is still offered, under its name.
    const mixed = themeRowFor([...THEMED.slice(0, 2), FIXTURE[0]], null);
    expect(mixed?.map((c) => c.name)).toEqual(["📅 Every decade", "📼 80s", "Party Hits"]);
  });

  it("is the one row under the field, with its own sentence over themes alone", () => {
    const row = themeRowFor(THEMED, null)!;
    const alone = fieldChipRow([], row, "field", { themed: true });
    expect(alone.playlists).toEqual(row);
    expect(alone.caption).toBe(THEME_CAPTION);
    expect(alone.label).toBe("Themes");
    expect([...alone.starterIds]).toEqual(row.map((c) => c.id));
    // Beside recent chips: still one row, recents first, deduped, no sentence.
    const recent = [{ id: THEMED[1].id, name: "My 80s" }];
    const beside = fieldChipRow(recent, row, "field", { themed: true });
    expect(beside.playlists.map((p) => p.id)).toEqual([THEMED[1].id, THEMED[0].id, THEMED[2].id]);
    expect(beside.caption).toBeNull();
    expect(beside.label).toBe("Playlists");
    expect(fieldChipRow(recent, row, null, { themed: true }).playlists).toEqual(recent);
  });

  it("counts a theme pick under the list's own key, by any route", () => {
    expect(starterKeyForId(THEMED[2].id, THEMED)).toBe("reggaeton");
  });
});

describe("the single-starter path is what it was before themes", () => {
  it("draws the real lists exactly as before: no theme row in either style", () => {
    expect(themeRowFor(startersFor("order"), "BR")).toBeNull();
    expect(themeRowFor(startersFor("guess"), "BR")).toBeNull();
  });

  it("ignores a theme on a style's only starter", () => {
    const one = [THEMED[1]];
    expect(themeRowFor(one, "US")).toBeNull();
    expect(fieldChipRow([], one, "field")).toEqual(fieldChipRow([], one, "field", { themed: false }));
    const row = fieldChipRow([], one, "field");
    expect(row.playlists).toEqual(one);
    expect(row.caption).toBe("No playlist handy? Start with ours");
    expect(row.label).toBe("Starter playlists");
  });

  it("keeps the page's old render on the null branch: same chips, same sentence, same row", () => {
    // app/page.tsx: the field row and the refusal row fall back to exactly
    // the calls they made before themes, and only a theme row changes them.
    const page = read("app/page.tsx");
    expect(page).toMatch(/const themeRow = themeRowFor\(styleStarters, themeRegion\);/);
    expect(page).toMatch(
      /const fieldRow = themeRow\s*\?\s*fieldChipRow\(recentPlaylists, themeRow, starterPlace, \{ themed: true \}\)\s*:\s*fieldChipRow\(recentPlaylists, styleStarters, starterPlace\);/
    );
    expect(page).toMatch(
      /:\s*\(\s*<PlaylistChips\s+label="Starter playlists"\s+caption=\{starterCaption\(styleStarters\.length\)\}\s+playlists=\{styleStarters\}/
    );
    // One PlaylistChips in the field slot, never a second row for themes.
    expect(page.match(/label=\{fieldRow\.label\}/g)).toHaveLength(1);
    expect(page).not.toMatch(/useState[^;]*regionFromLanguages/);
    expect(page).not.toMatch(/marketFromHeaders/);
  });
});

describe("the theme row's one counter", () => {
  beforeEach(() => {
    kv.incrs = [];
    __resetLivenessForTests();
  });

  it("is one impression per row and style, from a closed set", async () => {
    await recordStarterThemeRow("order");
    await recordStarterThemeRow("guess");
    await recordStarterThemeRow("party" as never);
    const metrics = kv.incrs.filter((k) => !k.endsWith(":live")).map((k) => k.replace("loop:stats:2026-11-17:", ""));
    expect(metrics).toEqual(["starter_theme_row:shown:order", "starter_theme_row:shown:guess"]);
  });

  it("is parsed from the beacon only for a play style", () => {
    expect(parsePulse({ kind: "starter_theme_row", style: "order" })).toEqual({ kind: "starter_theme_row", style: "order" });
    expect(parsePulse({ kind: "starter_theme_row", style: "decades" })).toBeNull();
    expect(parsePulse({ kind: "starter_theme_row" })).toBeNull();
  });

  it("is sent once per page per style, and printed by npm run stats", () => {
    const page = read("app/page.tsx");
    expect(page).toMatch(/themeRowReportedRef\.current\.has\(playStyle\)/);
    expect(page.match(/reportStarterThemeRow\(/g)).toHaveLength(1);
    const script = read("scripts/loop-stats.mjs");
    const rendered = script.match(/const RENDERED_PREFIXES = \[([^\]]*)\]/)?.[1] ?? "";
    expect(rendered).toContain('"starter_theme_row:"');
    expect(script).toContain("starter_theme_row:shown:${s}");
  });
});
