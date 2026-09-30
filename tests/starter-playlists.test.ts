// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isDeterministicPlaylistFailure } from "@/lib/error-messages";
import { PLAYLIST_REFUSAL_CODES } from "@/lib/loop-stats";
import { isEditorialId, isPlaylistId } from "@/lib/playlist-ref";
import {
  STARTER_PLAYLISTS,
  starterPlacement,
  type StarterContext,
  type StarterPlaylist,
} from "@/lib/starter-playlists";

/**
 * The starter playlists: a slot that ships empty.
 *
 * Two things are pinned. The rule for where starters are offered is tested
 * against a fixture, because the real list has nothing in it to test with.
 * And the real list is checked entry by entry — vacuously today, which is the
 * point: the check is here before the first id is, so whatever the site's
 * owner adds later is validated the day it is added.
 */

const FIXTURE: readonly StarterPlaylist[] = [
  { id: "3cEYpjA9oz9GiPac4AsH4n", name: "Party Hits", blurb: "Songs everyone knows" },
  { id: "5FJXhjdILmRA2z5bvz4nzf", name: "90s Rock", blurb: "Guitars, mostly" },
];

/** A first visit: Single Playlist, nothing typed, nothing remembered, no error. */
function context(over: Partial<StarterContext> = {}): StarterContext {
  return {
    starters: FIXTURE,
    singleMode: true,
    fieldEmpty: true,
    recentCount: 0,
    failureCode: null,
    ...over,
  };
}

describe("the list as it ships", () => {
  it("is empty", () => {
    // Deliberately. The slot is built; the playlists are the owner's to add,
    // from their own account. If this fails because ids were added, delete
    // this one test — the ones below are what check them.
    expect(STARTER_PLAYLISTS).toEqual([]);
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

  it("holds the fixture to the same rules, so the checks above are known to bite", () => {
    for (const { id } of FIXTURE) {
      expect(isPlaylistId(id)).toBe(true);
      expect(isEditorialId(id)).toBe(false);
    }
    expect(isPlaylistId("37i9dQZF1DXcBWIGoYBM5M")).toBe(true);
    expect(isEditorialId("37i9dQZF1DXcBWIGoYBM5M")).toBe(true);
    expect(isPlaylistId("not-an-id")).toBe(false);
  });
});

describe("with the list empty, nothing is offered anywhere", () => {
  it("returns null for every state the page can be in", () => {
    for (const singleMode of [true, false]) {
      for (const fieldEmpty of [true, false]) {
        for (const recentCount of [0, 1, 5]) {
          for (const failureCode of [null, "playlist_not_found", "playlist_editorial", "spotify_rate_limited"]) {
            const state = { singleMode, fieldEmpty, recentCount, failureCode };
            // Once against the real list by default, once against an
            // explicit empty one.
            expect(starterPlacement(state), JSON.stringify(state)).toBeNull();
            expect(starterPlacement({ ...state, starters: [] }), JSON.stringify(state)).toBeNull();
          }
        }
      }
    }
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
