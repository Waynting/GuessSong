import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CLIP_DURATIONS,
  DEFAULT_CLIP_DURATION,
  DEFAULT_PLAYER_ROWS,
  MIXED_SAMPLE_COUNTS,
  PLAYER_NAME_MAX,
  PLAYLIST_NAME_MAX,
  RECENT_PLAYLISTS_KEY,
  RECENT_PLAYLISTS_MAX,
  REMEMBERED_PLAYERS_MAX,
  SETUP_MEMORY_KEY,
  addRecentPlaylist,
  chipsFor,
  forgetSetup,
  initialSetup,
  mergeSetup,
  normalizeSetup,
  parseRecentPlaylists,
  parseSetupMemory,
  recallRecentPlaylists,
  recallSetup,
  rememberPlaylist,
  rememberSetup,
  songCountStateOf,
  type RememberedSetup,
  type SetupArrival,
} from "@/lib/setup-memory";
import { bumpHostGameCount, getHostGameCount, recallLoopRef, rememberLoopRef } from "@/lib/host-session";
import { MIXED_SUB_MODES } from "@/lib/loop-stats";
import { DEFAULT_SONG_COUNT_STATE, MAX_SONG_COUNT, SONG_COUNTS, isCustomSelected } from "@/lib/song-count";
import { SETUP_MODES } from "@/lib/start-status";
import { DEFAULT_SAMPLED_PER_PLAYER } from "@/types/room";
import {
  installQuotaStorage,
  installStorage,
  installThrowingStorage,
  uninstallStorage,
} from "./helpers/storage";

/**
 * The setup form's memory. The page that uses it is a `.tsx` module the suite
 * cannot import, and what it reads here it reads in a mount effect, on the
 * page that takes nearly all of the site's traffic, out of storage that an
 * older deploy wrote or a person edited. So the thing pinned hardest is that
 * nothing which can be in that storage can throw, and nothing in it can cost
 * the host a field it did not itself get wrong.
 */

const OWN = "3cEYpjA9oz9GiPac4AsH4n";
const OTHER = "5FJXhjdILmRA2z5bvz4nzf";
const EDITORIAL = "37i9dQZF1DXcBWIGoYBM5M";
const url = (id: string) => `https://open.spotify.com/playlist/${id}`;

/** What the form opened on before it remembered anything. */
const BLANK_FORM = {
  setupMode: "single",
  mixedSubMode: "room",
  playlistUrl: "",
  linkSource: "typed",
  players: ["", ""],
  clipDuration: 15,
  songCount: DEFAULT_SONG_COUNT_STATE,
  sampledPerPlayer: DEFAULT_SAMPLED_PER_PLAYER,
  buzzer: false,
};

const NOTHING_ASKED: SetupArrival = { sharedUrl: null, requestedMode: null };

const remembered = (over: Partial<RememberedSetup> = {}): RememberedSetup => ({
  playlistUrl: url(OWN),
  playlistName: "Friday Night",
  players: ["Amy", "Ben", "Cat"],
  clipDuration: 20,
  songCount: 30,
  mode: "single",
  mixedSubMode: "room",
  sampledPerPlayer: 8,
  buzzer: false,
  ...over,
});

const store = (value: unknown) => parseSetupMemory(JSON.stringify(value));

describe("parseSetupMemory — what counts as nothing remembered", () => {
  it("is null for an absent, empty or unreadable entry", () => {
    for (const raw of [null, "", "{", "not json", "undefined", "null", "7", '"a string"', "[]", "[1,2]", "true"]) {
      expect(parseSetupMemory(raw), String(raw)).toBeNull();
    }
  });

  it("reads back what was written", () => {
    expect(store(remembered())).toEqual(remembered());
  });

  it("fills an empty record with the form's own defaults", () => {
    expect(store({})).toEqual({
      playlistUrl: "",
      playlistName: "",
      players: [],
      clipDuration: DEFAULT_CLIP_DURATION,
      songCount: DEFAULT_SONG_COUNT_STATE.count,
      mode: "single",
      mixedSubMode: "room",
      sampledPerPlayer: DEFAULT_SAMPLED_PER_PLAYER,
      buzzer: false,
    });
  });
});

describe("every field is repaired on its own", () => {
  it("never lets one bad field cost the host the others", () => {
    // The failure this guards is the easy implementation: validate the
    // record, and on any failure return null. A deploy that stopped offering
    // one clip length would then empty every returning host's form.
    const damaged = store({
      ...remembered(),
      clipDuration: "soon",
      songCount: { n: 3 },
      mode: "trial",
      mixedSubMode: 7,
      sampledPerPlayer: null,
      buzzer: "yes",
    });
    expect(damaged).toEqual(
      remembered({
        clipDuration: DEFAULT_CLIP_DURATION,
        songCount: DEFAULT_SONG_COUNT_STATE.count,
        mode: "single",
        mixedSubMode: "room",
        sampledPerPlayer: DEFAULT_SAMPLED_PER_PLAYER,
        buzzer: false,
      })
    );
  });

  it("snaps a clip length that is not offered to the nearest one that is", () => {
    const cases: Array<[unknown, number]> = [
      [15, 15],
      [30, 30],
      [5, 5],
      [17, 15],
      [18, 20],
      [0, 5],
      [-40, 5],
      [45, 30],
      [1e9, 30],
      [25, 20], // a tie goes to the shorter clip
      [7.5, 5],
    ];
    for (const [stored, expected] of cases) {
      expect(store({ clipDuration: stored })?.clipDuration, String(stored)).toBe(expected);
      expect(CLIP_DURATIONS).toContain(expected);
    }
    for (const junk of ["15", null, undefined, Number.NaN, {}, [], true]) {
      expect(normalizeSetup({ clipDuration: junk }).clipDuration, String(junk)).toBe(DEFAULT_CLIP_DURATION);
    }
    // JSON has no Infinity; it arrives as null and reads as the default.
    expect(store({ clipDuration: Number.POSITIVE_INFINITY })?.clipDuration).toBe(DEFAULT_CLIP_DURATION);
  });

  it("does the same for Mixed mode's songs per player", () => {
    const cases: Array<[unknown, number]> = [
      [8, 8],
      [12, 12],
      [6, 5],
      [9, 8], // a tie goes to the smaller pool
      [11, 10],
      [0, 5],
      [500, 12],
    ];
    for (const [stored, expected] of cases) {
      expect(store({ sampledPerPlayer: stored })?.sampledPerPlayer, String(stored)).toBe(expected);
      expect(MIXED_SAMPLE_COUNTS).toContain(expected);
    }
    expect(store({ sampledPerPlayer: "8" })?.sampledPerPlayer).toBe(DEFAULT_SAMPLED_PER_PLAYER);
  });

  it("puts the song count through lib/song-count.ts's rule for a finished field", () => {
    // Clamped, not rejected: reading storage is a commit, not a keystroke.
    const cases: Array<[unknown, number | "all"]> = [
      [20, 20],
      ["all", "all"],
      [37, 37],
      [1, 1],
      [0, 1],
      [-5, 1],
      [MAX_SONG_COUNT, MAX_SONG_COUNT],
      [MAX_SONG_COUNT + 1, MAX_SONG_COUNT],
      [1e12, MAX_SONG_COUNT],
      [12.9, 12],
      ["45", 45],
    ];
    for (const [stored, expected] of cases) {
      expect(store({ songCount: stored })?.songCount, String(stored)).toBe(expected);
    }
    for (const junk of ["ALL", "many", "", null, {}, [], true, Number.NaN]) {
      expect(normalizeSetup({ songCount: junk }).songCount, String(junk)).toBe(DEFAULT_SONG_COUNT_STATE.count);
    }
  });

  it("reads a mode or sub-mode it does not know as the default, never as a third member", () => {
    for (const mode of SETUP_MODES) {
      expect(store({ mode })?.mode).toBe(mode);
    }
    for (const mixedSubMode of MIXED_SUB_MODES) {
      expect(store({ mixedSubMode })?.mixedSubMode).toBe(mixedSubMode);
    }
    // `quiz` was a setup mode once; `constructor` and `__proto__` are what a
    // lookup in a plain object answers to if it is asked carelessly.
    for (const junk of ["quiz", "trial", "Single", "MIXED", "", "constructor", "__proto__", "toString", 1, null, {}]) {
      expect(normalizeSetup({ mode: junk }).mode, String(junk)).toBe("single");
      expect(normalizeSetup({ mixedSubMode: junk }).mixedSubMode, String(junk)).toBe("room");
    }
  });

  it("has a sub-mode allow-list that matches the union the counters key off", () => {
    // lib/setup-memory.ts cannot import MIXED_SUB_MODES — a value import from
    // lib/loop-stats.ts would carry the KV client into the browser — so it
    // keeps its own, and this is what holds the two together.
    const accepted = ["room", "phone", "qr", "pass", "both"].filter(
      (value) => normalizeSetup({ mixedSubMode: value }).mixedSubMode === value
    );
    expect(accepted).toEqual([...MIXED_SUB_MODES]);
  });

  it("turns the buzzer on for `true` and for nothing else", () => {
    expect(store({ buzzer: true })?.buzzer).toBe(true);
    for (const junk of ["true", 1, {}, [], "on", null, false, 0]) {
      expect(normalizeSetup({ buzzer: junk }).buzzer, String(junk)).toBe(false);
    }
  });
});

describe("the remembered link", () => {
  it("is stored as the playlist's one address, without whatever was pasted around it", () => {
    const pasted = `https://open.spotify.com/intl-ja/playlist/${OWN}?si=abcdef0123456789`;
    expect(store({ playlistUrl: pasted, playlistName: "Mix" })?.playlistUrl).toBe(url(OWN));
    expect(store({ playlistUrl: `spotify:playlist:${OWN}`, playlistName: "Mix" })?.playlistUrl).toBe(url(OWN));
  });

  it("is nothing at all unless it holds an id of the right shape", () => {
    for (const junk of [
      "",
      "https://open.spotify.com/playlist/",
      "https://open.spotify.com/playlist/short",
      `https://open.spotify.com/album/${OWN}`,
      "javascript:alert(1)",
      "https://evil.example/?next=playlist/../../x",
      OWN,
      42,
      null,
      { href: url(OWN) },
    ]) {
      const parsed = normalizeSetup({ playlistUrl: junk, playlistName: "Mix" });
      expect(parsed.playlistUrl, String(junk)).toBe("");
      // A name with no link is the name of nothing.
      expect(parsed.playlistName, String(junk)).toBe("");
    }
  });

  it("only ever puts an open.spotify.com playlist address in the field", () => {
    // A foreign host is not a playlist link at all (lib/spotify-link.ts
    // checks the host), so nothing is restored; a real one is stored
    // canonical, with its `?si=` and anything else dropped.
    const hostile = `https://evil.example/playlist/${OWN}?x=<script>`;
    expect(store({ playlistUrl: hostile })?.playlistUrl).toBe("");
    const pasted = `https://open.spotify.com/intl-ja/playlist/${OWN}?si=x<script>`;
    expect(store({ playlistUrl: pasted })?.playlistUrl).toBe(url(OWN));
  });

  it("bounds the name", () => {
    const long = "x".repeat(5000);
    expect(store({ playlistUrl: url(OWN), playlistName: long })?.playlistName).toHaveLength(PLAYLIST_NAME_MAX);
    expect(store({ playlistUrl: url(OWN), playlistName: "  Mix  " })?.playlistName).toBe("Mix");
    expect(store({ playlistUrl: url(OWN), playlistName: 7 })?.playlistName).toBe("");
  });
});

describe("the remembered roster", () => {
  it("trims names and drops the blank ones", () => {
    expect(store({ players: ["  Amy ", "", "   ", "Ben"] })?.players).toEqual(["Amy", "Ben"]);
  });

  it("drops anything that is not a name", () => {
    expect(store({ players: ["Amy", 7, null, { name: "Ben" }, ["Cat"], true, "Dan"] })?.players).toEqual([
      "Amy",
      "Dan",
    ]);
    for (const junk of ["Amy", 3, null, { 0: "Amy" }, true]) {
      expect(normalizeSetup({ players: junk }).players, String(junk)).toEqual([]);
    }
  });

  it("cuts a name to the field's own limit", () => {
    const [name] = store({ players: ["a".repeat(200)] })?.players ?? [];
    expect(name).toHaveLength(PLAYER_NAME_MAX);
  });

  it("never cuts a character in half", () => {
    // `slice` counts UTF-16 units and will stop between the two halves of an
    // emoji. A lone surrogate in a name goes into the game payload and onto
    // the scoreboard.
    const party = "🎉"; // two units
    const name = `${"a".repeat(PLAYER_NAME_MAX - 1)}${party}`;
    const [cut] = store({ players: [name] })?.players ?? [];
    expect(cut).toBe("a".repeat(PLAYER_NAME_MAX - 1));
    expect(cut.length).toBeLessThanOrEqual(PLAYER_NAME_MAX);

    const [whole] = store({ players: [party.repeat(40)] })?.players ?? [];
    expect(whole).toBe(party.repeat(PLAYER_NAME_MAX / 2));
    expect(/[\uD800-\uDBFF]$/.test(whole), "ends on a lone high surrogate").toBe(false);
    // Every name that comes back is one the field could have held.
    expect(whole.length).toBeLessThanOrEqual(PLAYER_NAME_MAX);
  });

  it("keeps Chinese names whole", () => {
    expect(store({ players: ["小明", " 阿華 ", "王大同"] })?.players).toEqual(["小明", "阿華", "王大同"]);
  });

  it("caps how many names a hand-edited entry can put on the page", () => {
    const crowd = Array.from({ length: 5000 }, (_, i) => `P${i}`);
    const players = store({ players: crowd })?.players ?? [];
    expect(players).toHaveLength(REMEMBERED_PLAYERS_MAX);
    expect(players[0]).toBe("P0");
    // The cap counts names kept, not entries read: blanks ahead of the real
    // ones do not use it up.
    const padded = [...Array.from({ length: 100 }, () => " "), "Amy"];
    expect(store({ players: padded })?.players).toEqual(["Amy"]);
  });
});

describe("mergeSetup — each start path knows a different part of the form", () => {
  it("keeps the playlist and the names through a Mixed game", () => {
    const after = mergeSetup(remembered(), {
      mode: "mixed",
      mixedSubMode: "phone",
      sampledPerPlayer: 10,
      clipDuration: 10,
      buzzer: false,
    });
    expect(after).toEqual(
      remembered({ mode: "mixed", mixedSubMode: "phone", sampledPerPlayer: 10, clipDuration: 10 })
    );
  });

  it("keeps the names through a buzzer game, which hides the fields they were typed in", () => {
    const after = mergeSetup(remembered(), {
      mode: "single",
      playlistUrl: url(OTHER),
      playlistName: "Other",
      clipDuration: 15,
      songCount: "all",
      buzzer: true,
    });
    expect(after.players).toEqual(["Amy", "Ben", "Cat"]);
    expect(after.playlistUrl).toBe(url(OTHER));
    expect(after.buzzer).toBe(true);
  });

  it("starts from the defaults on a device that remembered nothing", () => {
    const first = mergeSetup(null, { mode: "mixed", mixedSubMode: "room", clipDuration: 30 });
    expect(first.mode).toBe("mixed");
    expect(first.clipDuration).toBe(30);
    expect(first.players).toEqual([]);
    expect(first.playlistUrl).toBe("");
  });

  it("repairs what it is handed, so what is written is already what would be read", () => {
    const written = mergeSetup(null, {
      playlistUrl: `${url(OWN)}?si=abc`,
      playlistName: "  Mix ",
      players: [" Amy ", ""],
      clipDuration: 17,
      songCount: 9999,
    });
    expect(parseSetupMemory(JSON.stringify(written))).toEqual(written);
    expect(written.playlistUrl).toBe(url(OWN));
    expect(written.players).toEqual(["Amy"]);
    expect(written.clipDuration).toBe(15);
    expect(written.songCount).toBe(MAX_SONG_COUNT);
  });
});

describe("recent playlists", () => {
  it("puts a playlist that has just loaded at the front", () => {
    const list = addRecentPlaylist([{ id: OTHER, name: "Other" }], { url: url(OWN), name: "Mine" });
    expect(list).toEqual([
      { id: OWN, name: "Mine" },
      { id: OTHER, name: "Other" },
    ]);
  });

  it("is one chip per playlist, however the link was pasted", () => {
    // Every share of the same playlist carries a different ?si= token.
    let list = addRecentPlaylist([], { url: `${url(OWN)}?si=aaaa`, name: "Mine" });
    list = addRecentPlaylist(list, { url: url(OTHER), name: "Other" });
    list = addRecentPlaylist(list, { url: `https://open.spotify.com/intl-ja/playlist/${OWN}?si=bbbb`, name: "Mine" });
    expect(list.map((p) => p.id)).toEqual([OWN, OTHER]);
  });

  it("takes the playlist's current name when it moves to the front", () => {
    const list = addRecentPlaylist([{ id: OWN, name: "Old name" }], { url: url(OWN), name: "New name" });
    expect(list).toEqual([{ id: OWN, name: "New name" }]);
  });

  it("keeps five, and the one that falls off is the oldest", () => {
    const ids = ["A", "B", "C", "D", "E", "F"].map((c) => c.repeat(22));
    let list: ReturnType<typeof addRecentPlaylist> = [];
    for (const id of ids) list = addRecentPlaylist(list, { url: url(id), name: `List ${id[0]}` });
    expect(list).toHaveLength(RECENT_PLAYLISTS_MAX);
    expect(list.map((p) => p.name)).toEqual(["List F", "List E", "List D", "List C", "List B"]);
  });

  it("does not invent a chip for a link with no id or a playlist with no name", () => {
    const before = [{ id: OTHER, name: "Other" }];
    for (const loaded of [
      { url: "https://open.spotify.com/playlist/short", name: "Mix" },
      { url: `https://open.spotify.com/album/${OWN}`, name: "Mix" },
      { url: url(OWN), name: "" },
      { url: url(OWN), name: "   " },
      { url: url(OWN), name: undefined },
      { url: url(OWN), name: 12 },
      { url: undefined, name: "Mix" },
      { url: url(EDITORIAL), name: "Today's Top Hits" },
    ]) {
      expect(addRecentPlaylist(before, loaded), JSON.stringify(loaded)).toEqual(before);
    }
  });

  it("does not change the list it was handed", () => {
    const before = [{ id: OTHER, name: "Other" }];
    addRecentPlaylist(before, { url: url(OWN), name: "Mine" });
    expect(before).toEqual([{ id: OTHER, name: "Other" }]);
  });

  it("reads back only what could be a chip", () => {
    const raw = JSON.stringify([
      { id: OWN, name: "Mine" },
      { id: OWN, name: "Mine again" }, // the same playlist twice
      { id: "short", name: "Bad id" },
      { id: OTHER }, // no name
      { id: OTHER, name: "   " },
      { id: EDITORIAL, name: "Today's Top Hits" },
      null,
      "a string",
      7,
      [OWN, "Mine"],
      { id: OTHER, name: "  Other  ", url: "javascript:alert(1)" },
    ]);
    expect(parseRecentPlaylists(raw)).toEqual([
      { id: OWN, name: "Mine" },
      { id: OTHER, name: "Other" },
    ]);
  });

  it("is an empty list for anything that is not one", () => {
    for (const raw of [null, "", "{", "{}", "7", '"x"', "null", '{"0":{"id":"x"}}']) {
      expect(parseRecentPlaylists(raw), String(raw)).toEqual([]);
    }
  });

  it("reads at most five, even from an entry somebody made longer", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: String.fromCharCode(65 + (i % 26)).repeat(21) + String(i % 10),
      name: `List ${i}`,
    }));
    expect(parseRecentPlaylists(JSON.stringify(many))).toHaveLength(RECENT_PLAYLISTS_MAX);
  });
});

describe("chipsFor — the link in the field always has a name", () => {
  const recent = [
    { id: OTHER, name: "Other" },
    { id: OWN, name: "Mine, as the list has it" },
  ];

  it("leaves the list alone when the remembered playlist is already in it", () => {
    // Order included: the list is newest first as it was written, and the
    // setup's copy of the name does not overrule the chip's.
    expect(chipsFor(recent, remembered({ playlistName: "Mine, as the setup has it" }))).toEqual(recent);
  });

  it("adds the remembered playlist at the front when the list lost it", () => {
    // Two keys, two writes: a browser at its quota can keep one and refuse
    // the other.
    expect(chipsFor([{ id: OTHER, name: "Other" }], remembered())).toEqual([
      { id: OWN, name: "Friday Night" },
      { id: OTHER, name: "Other" },
    ]);
    expect(chipsFor([], remembered())).toEqual([{ id: OWN, name: "Friday Night" }]);
  });

  it("still shows five at most", () => {
    const full = ["A", "B", "C", "D", "E"].map((c) => ({ id: c.repeat(22), name: `List ${c}` }));
    const chips = chipsFor(full, remembered());
    expect(chips).toHaveLength(RECENT_PLAYLISTS_MAX);
    expect(chips[0]).toEqual({ id: OWN, name: "Friday Night" });
    expect(chips.map((p) => p.name)).not.toContain("List E");
  });

  it("adds nothing when there is no playlist to name, or no name to give it", () => {
    expect(chipsFor(recent, null)).toEqual(recent);
    expect(chipsFor([], null)).toEqual([]);
    expect(chipsFor([], remembered({ playlistUrl: "", playlistName: "" }))).toEqual([]);
    expect(chipsFor([], remembered({ playlistName: "" }))).toEqual([]);
  });

  it("hands back a list of its own", () => {
    const chips = chipsFor(recent, null);
    chips.pop();
    expect(recent).toHaveLength(2);
  });
});

describe("songCountStateOf", () => {
  it("lights the pill for a count that has one, and fills the field for one that does not", () => {
    for (const preset of SONG_COUNTS) {
      expect(songCountStateOf(preset)).toEqual({ count: preset, field: "" });
    }
    const typed = songCountStateOf(37);
    expect(typed).toEqual({ count: 37, field: "37" });
    // The state the control would be in had the host typed it and left the
    // field: the custom field reads as the selected one.
    expect(isCustomSelected(typed)).toBe(true);
  });
});

describe("initialSetup — the URL outranks the memory, and the memory outranks the defaults", () => {
  it("is exactly the form the page has always opened on when nothing is asked or remembered", () => {
    expect(initialSetup(NOTHING_ASKED, null)).toEqual(BLANK_FORM);
  });

  it("fills the form from the last game", () => {
    expect(initialSetup(NOTHING_ASKED, remembered())).toEqual({
      setupMode: "single",
      mixedSubMode: "room",
      playlistUrl: url(OWN),
      linkSource: "restored",
      players: ["Amy", "Ben", "Cat"],
      clipDuration: 20,
      songCount: { count: 30, field: "" },
      sampledPerPlayer: 8,
      buzzer: false,
    });
  });

  it("lets a shared playlist beat the remembered one, and keeps everything else", () => {
    const shared = `${url(OTHER)}?si=abc`;
    const form = initialSetup({ sharedUrl: shared, requestedMode: null }, remembered());
    expect(form.playlistUrl).toBe(shared);
    expect(form.linkSource).toBe("shared");
    expect(form.players).toEqual(["Amy", "Ben", "Cat"]);
    expect(form.clipDuration).toBe(20);
  });

  it("opens a shared playlist on Single even when the last game was Mixed", () => {
    // The field a share fills is not on screen in Mixed.
    const form = initialSetup({ sharedUrl: url(OTHER), requestedMode: null }, remembered({ mode: "mixed" }));
    expect(form.setupMode).toBe("single");
    expect(form.playlistUrl).toBe(url(OTHER));
  });

  it("treats an empty ?playlist= as no share at all", () => {
    for (const sharedUrl of ["", "   ", null]) {
      const form = initialSetup({ sharedUrl, requestedMode: null }, remembered());
      expect(form.playlistUrl, String(sharedUrl)).toBe(url(OWN));
      expect(form.linkSource, String(sharedUrl)).toBe("restored");
    }
  });

  it("lets ?mode=mixed beat the remembered mode", () => {
    const asked: SetupArrival = { sharedUrl: null, requestedMode: "mixed" };
    expect(initialSetup(asked, remembered({ mode: "single" })).setupMode).toBe("mixed");
    expect(initialSetup(asked, null).setupMode).toBe("mixed");
    // And the sub-mode the host last used is still theirs.
    expect(initialSetup(asked, remembered({ mixedSubMode: "phone" })).mixedSubMode).toBe("phone");
  });

  it("believes ?mode=mixed over a ?playlist= beside it", () => {
    const form = initialSetup({ sharedUrl: url(OTHER), requestedMode: "mixed" }, null);
    expect(form.setupMode).toBe("mixed");
  });

  it("returns to the mode that was played last when the URL says nothing", () => {
    expect(initialSetup(NOTHING_ASKED, remembered({ mode: "mixed", mixedSubMode: "phone" }))).toMatchObject({
      setupMode: "mixed",
      mixedSubMode: "phone",
    });
  });

  it("calls the link typed when there is none to restore", () => {
    const form = initialSetup(NOTHING_ASKED, remembered({ playlistUrl: "", playlistName: "" }));
    expect(form.playlistUrl).toBe("");
    expect(form.linkSource).toBe("typed");
  });

  it("always leaves at least two name fields, and never an empty one after a full roster", () => {
    const rows = (players: string[]) => initialSetup(NOTHING_ASKED, remembered({ players })).players;
    expect(rows([])).toEqual(["", ""]);
    expect(rows(["Amy"])).toEqual(["Amy", ""]);
    expect(rows(["Amy", "Ben"])).toEqual(["Amy", "Ben"]);
    expect(rows(["Amy", "Ben", "Cat", "Dan"])).toEqual(["Amy", "Ben", "Cat", "Dan"]);
    expect(rows([]).length).toBe(DEFAULT_PLAYER_ROWS);
  });

  it("restores a typed song count into the typed field", () => {
    expect(initialSetup(NOTHING_ASKED, remembered({ songCount: 37 })).songCount).toEqual({
      count: 37,
      field: "37",
    });
    expect(initialSetup(NOTHING_ASKED, remembered({ songCount: "all" })).songCount).toEqual({
      count: "all",
      field: "",
    });
  });

  it("is what Start fresh applies: the same arrival with the memory taken away", () => {
    // A fresh start on a shared link keeps the link; on /?mode=mixed it stays
    // on Mixed. Neither was the device's to forget.
    expect(initialSetup({ sharedUrl: url(OTHER), requestedMode: null }, null)).toEqual({
      ...BLANK_FORM,
      playlistUrl: url(OTHER),
      linkSource: "shared",
    });
    expect(initialSetup({ sharedUrl: null, requestedMode: "mixed" }, null)).toEqual({
      ...BLANK_FORM,
      setupMode: "mixed",
    });
  });

  it("hands every mount its own roster array", () => {
    const first = initialSetup(NOTHING_ASKED, null);
    first.players.push("Amy");
    expect(initialSetup(NOTHING_ASKED, null).players).toEqual(["", ""]);
  });
});

describe("in the browser", () => {
  let map: Map<string, string>;

  beforeEach(() => {
    map = installStorage();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    uninstallStorage();
  });

  it("really has storage, so the assertions below are not vacuous", () => {
    // jsdom supplies none here; see tests/helpers/storage.ts.
    window.localStorage.setItem("canary", "1");
    expect(window.localStorage.getItem("canary")).toBe("1");
  });

  it("remembers nothing until a game has started", () => {
    expect(recallSetup()).toBeNull();
    expect(recallRecentPlaylists()).toEqual([]);
    expect(map.size).toBe(0);
  });

  it("writes on a start and reads it back on the next visit", () => {
    rememberSetup({
      mode: "single",
      playlistUrl: `${url(OWN)}?si=abc`,
      playlistName: "Friday Night",
      players: ["Amy ", "Ben"],
      clipDuration: 20,
      songCount: 30,
      buzzer: false,
    });
    rememberPlaylist(`${url(OWN)}?si=abc`, "Friday Night");

    expect(recallSetup()).toEqual(remembered({ players: ["Amy", "Ben"] }));
    expect(recallRecentPlaylists()).toEqual([{ id: OWN, name: "Friday Night" }]);
    // And no tracking token was kept.
    expect([...map.values()].join("")).not.toContain("si=");
  });

  it("adds a Mixed game on top of what was there, rather than in place of it", () => {
    rememberSetup({ mode: "single", playlistUrl: url(OWN), playlistName: "Mine", players: ["Amy"] });
    rememberSetup({ mode: "mixed", mixedSubMode: "phone", sampledPerPlayer: 12, clipDuration: 10, buzzer: false });
    expect(recallSetup()).toMatchObject({
      mode: "mixed",
      mixedSubMode: "phone",
      sampledPerPlayer: 12,
      playlistUrl: url(OWN),
      players: ["Amy"],
    });
  });

  it("writes nothing to the recent list for a playlist it cannot make a chip of", () => {
    rememberPlaylist("https://open.spotify.com/playlist/short", "Mix");
    rememberPlaylist(url(OWN), undefined);
    expect(map.has(RECENT_PLAYLISTS_KEY)).toBe(false);
  });

  it("forgets both, and leaves the instruments alone", () => {
    rememberSetup({ playlistUrl: url(OWN), playlistName: "Mine", players: ["Amy"] });
    rememberPlaylist(url(OWN), "Mine");
    bumpHostGameCount();
    bumpHostGameCount();
    rememberLoopRef("buzz_cta");

    forgetSetup();

    expect(recallSetup()).toBeNull();
    expect(recallRecentPlaylists()).toEqual([]);
    expect(map.has(SETUP_MEMORY_KEY)).toBe(false);
    expect(map.has(RECENT_PLAYLISTS_KEY)).toBe(false);
    // Start fresh is on the busiest page of the site. If it reset the game
    // counter, every tidy-minded repeat host would read as a first-timer.
    expect(getHostGameCount()).toBe(2);
    expect(recallLoopRef()).toBe("buzz_cta");
  });

  it("repairs an entry an older deploy or a person left behind", () => {
    map.set(SETUP_MEMORY_KEY, JSON.stringify({ playlistUrl: url(OWN), clipDuration: 45, mode: "trial" }));
    map.set(RECENT_PLAYLISTS_KEY, "{not json");
    expect(recallSetup()).toMatchObject({ playlistUrl: url(OWN), clipDuration: 30, mode: "single" });
    expect(recallRecentPlaylists()).toEqual([]);
    // A damaged recent list does not stop the next playlist being remembered.
    rememberPlaylist(url(OTHER), "Other");
    expect(recallRecentPlaylists()).toEqual([{ id: OTHER, name: "Other" }]);
  });
});

describe("a browser that will not keep anything", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    uninstallStorage();
  });

  const everyCall = () => {
    expect(recallSetup()).toBeNull();
    expect(recallRecentPlaylists()).toEqual([]);
    rememberSetup({ playlistUrl: url(OWN), playlistName: "Mine", players: ["Amy"] });
    rememberPlaylist(url(OWN), "Mine");
    forgetSetup();
  };

  it("never throws when the storage access itself throws", () => {
    // Safari with "Block All Cookies". These run in the setup page's mount
    // effect and between saveGame and the navigation to /game; a throw from
    // either is the crash screen, or a loaded playlist reported as a failed one.
    installThrowingStorage();
    expect(everyCall).not.toThrow();
  });

  it("never throws when every write is refused", () => {
    const map = installQuotaStorage();
    expect(everyCall).not.toThrow();
    expect(map.size).toBe(0);
  });

  it("never throws when there is no storage at all", () => {
    uninstallStorage();
    expect(everyCall).not.toThrow();
  });

  it("opens the form it always opened when there is nothing to read", () => {
    installThrowingStorage();
    expect(initialSetup(NOTHING_ASKED, recallSetup())).toEqual(BLANK_FORM);
  });

  it("does not throw on a read that fails halfway", () => {
    installStorage({
      getItem: () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
    expect(everyCall).not.toThrow();
  });
});
