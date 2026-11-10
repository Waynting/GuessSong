// @vitest-environment node
import { describe, it, expect } from "vitest";
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
  type StarterContext,
  type StarterPlaylist,
} from "@/lib/starter-playlists";

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
