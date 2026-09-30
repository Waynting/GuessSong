// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SETUP_SOURCES } from "@/lib/loop-stats";
import { parsePulse } from "@/lib/pulse";

const pulse = vi.hoisted(() => ({ sent: [] as unknown[] }));

vi.mock("@/lib/pulse-client", () => ({
  sendPulse: (event: unknown) => {
    pulse.sent.push(event);
    return true;
  },
}));

const { reportGameStart } = await import("@/lib/loop-client");

/**
 * The setup page's memory, help and chips, as far as the suite can see the
 * page that wires them.
 *
 * The rules are in `lib/` and tested there (`setup-memory`, `playlist-help`,
 * `starter-playlists`, `playlist-ref`). What is left in `app/page.tsx` is
 * wiring, and each line of it pinned here is one that fails silently if it is
 * undone: the form would still render, the build would still pass, and a
 * returning host would be back to an empty form, or a half-typed name would be
 * remembered as a player, or the second press of Start on a dead link would
 * lose the way to the guide. Read the source, the way
 * tests/setup-pages.test.ts does.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** The source with its comments removed, so a rule named in prose does not pass for one in code. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const HOME = "app/page.tsx";
const ASSIST = "components/setup-assist.tsx";

/** Every index at which `needle` starts in `haystack`. */
function positions(haystack: string, needle: string): number[] {
  const found: number[] = [];
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    found.push(at);
  }
  return found;
}

beforeEach(() => {
  pulse.sent = [];
});

describe("reportGameStart carries the setup source", () => {
  it("sends it beside the index, and the server reads it back as the same source", () => {
    for (const source of SETUP_SOURCES) {
      pulse.sent = [];
      reportGameStart(2, undefined, source);
      expect(pulse.sent).toEqual([{ kind: "game_started", hostGameIndex: 2, source }]);
      // Through a JSON round trip, which is what the beacon is.
      expect(parsePulse(JSON.parse(JSON.stringify(pulse.sent[0])))).toEqual({
        kind: "game_started",
        hostGameIndex: 2,
        source,
      });
    }
  });

  it("sends a mixed game's sub-mode and source together", () => {
    reportGameStart(1, "room", "mixed");
    expect(pulse.sent).toEqual([{ kind: "game_started", hostGameIndex: 1, mixed: "room", source: "mixed" }]);
  });

  it("omits both rather than sending a sentinel, so an old caller's beacon is unchanged", () => {
    reportGameStart(4);
    expect(pulse.sent).toEqual([{ kind: "game_started", hostGameIndex: 4 }]);
    expect(Object.keys(pulse.sent[0] as object)).toEqual(["kind", "hostGameIndex"]);
    pulse.sent = [];
    reportGameStart(4, "phone");
    expect(pulse.sent).toEqual([{ kind: "game_started", hostGameIndex: 4, mixed: "phone" }]);
  });
});

describe("the page remembers a game when it starts, and at no other time", () => {
  const body = code(read(HOME));

  it("never touches storage itself", () => {
    // Storage throws on the property access in a locked-down browser, and this
    // page's mount effect is where that becomes the crash screen. Everything
    // goes through lib/setup-memory.ts, which goes through lib/host-session.ts.
    expect(body).not.toMatch(/\blocalStorage\b/);
    expect(body).not.toMatch(/\bsessionStorage\b/);
    const memory = code(read("lib/setup-memory.ts"));
    expect(memory).not.toMatch(/\blocalStorage\b/);
    expect(memory).not.toMatch(/\bwindow\b/);
    expect(memory).toMatch(/import \{ readStored, removeStored, writeStored \} from "@\/lib\/host-session"/);
  });

  it("writes the setup on each of the three hosted starts, after the game is stored", () => {
    const starts = positions(body, "...recordHostedStart(");
    const writes = positions(body, "rememberSetup({");
    const leaves = positions(body, 'router.push("/game")');
    const stored = positions(body, "if (!saveGame(payload)) throw");
    expect(starts).toHaveLength(3);
    expect(writes).toHaveLength(3);
    expect(leaves).toHaveLength(3);
    expect(stored).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      // Stored, counted, remembered, gone — in that order, on every path. A
      // write ahead of `saveGame` would remember a game that never started.
      expect(stored[i]).toBeLessThan(starts[i]);
      expect(starts[i]).toBeLessThan(writes[i]);
      expect(writes[i]).toBeLessThan(leaves[i]);
    }
  });

  it("has no other writer: nothing is remembered on a keystroke", () => {
    expect(positions(body, "rememberSetup(")).toHaveLength(3);
    expect(positions(body, "rememberPlaylist(")).toHaveLength(1);
    // No handler on a field reaches the memory.
    for (const handler of body.match(/on(?:Change|Blur|Input)=\{[\s\S]*?\}\}?/g) ?? []) {
      expect(handler).not.toMatch(/remember|forgetSetup|writeStored/);
    }
  });

  it("keeps a playlist only once it has loaded, under the name the response gave it", () => {
    expect(body).toMatch(/rememberPlaylist\(playlistUrl, data\.name\);/);
    expect(body).toMatch(/playlistName: data\.name,/);
    const loaded = body.indexOf('if (!res.ok) throw apiError(data, "playlist_load_failed");');
    expect(loaded).toBeGreaterThan(-1);
    expect(body.indexOf("rememberPlaylist(")).toBeGreaterThan(loaded);
  });

  it("leaves the roster alone after a buzzer game, and never keeps a Mixed game's contributors", () => {
    // The name fields are hidden in Buzzer Mode, so what they hold is not who
    // played; and a mix's contributors are other people's names.
    expect(body).toMatch(/\.\.\.\(room \? \{\} : \{ players: validPlayers \}\),/);
    const mixedWrites = [...body.matchAll(/rememberSetup\(\{\s*mode: "mixed",[\s\S]*?\}\);/g)].map((m) => m[0]);
    expect(mixedWrites).toHaveLength(2);
    for (const write of mixedWrites) {
      expect(write).not.toMatch(/players|playlistUrl|playlistName|contribut|mixedContributions/);
      expect(write).toMatch(/mixedSubMode: "(room|phone)"/);
    }
    expect(mixedWrites.map((w) => w.match(/mixedSubMode: "(\w+)"/)?.[1]).sort()).toEqual(["phone", "room"]);
  });
});

describe("the page restores on arrival, in an effect", () => {
  const body = code(read(HOME));

  it("opens on the defaults and fills the form after mount, so the prerender matches", () => {
    // The page is statically prerendered. Reading storage in a `useState`
    // initialiser would render a form the server never sent.
    expect(body).toMatch(/const \[playlistUrl, setPlaylistUrl\] = useState\(""\);/);
    expect(body).toMatch(/const \[players, setPlayers\] = useState<string\[\]>\(\["", ""\]\);/);
    expect(body).toMatch(/const \[clipDuration, setClipDuration\] = useState\(DEFAULT_CLIP_DURATION\);/);
    expect(body).toMatch(/const \[recentPlaylists, setRecentPlaylists\] = useState<RecentPlaylist\[\]>\(\[\]\);/);
    expect(body).not.toMatch(/useState\([^)]*recall/);
  });

  it("lets initialSetup decide between the URL and the memory, after the quiz has been sent on its way", () => {
    const redirect = body.indexOf('if (requestedSetupMode(query) === "quiz")');
    const restore = body.indexOf("applySetup(initialSetup(arrival, remembered));");
    expect(redirect).toBeGreaterThan(-1);
    expect(restore).toBeGreaterThan(redirect);
    expect(body).toMatch(
      /const arrival: SetupArrival = \{\s*sharedUrl: query\.get\("playlist"\),\s*requestedMode: requestedSetupMode\(query\),\s*\};/
    );
    expect(body).toMatch(/const remembered = recallSetup\(\);/);
    expect(body).toMatch(/setRecalled\(remembered !== null\);/);
    expect(body).toMatch(/setRecentPlaylists\(chipsFor\(recallRecentPlaylists\(\), remembered\)\);/);
    // The share target's link is no longer set here on its own: it would be
    // a second rule about who wins, beside the one in lib/.
    expect(body).not.toMatch(/if \(shared\) setPlaylistUrl/);
  });

  it("still remembers the loop's ref before anything else can leave the page", () => {
    const ref = body.indexOf("if (ref) rememberLoopRef(ref);");
    expect(ref).toBeGreaterThan(-1);
    expect(ref).toBeLessThan(body.indexOf('if (requestedSetupMode(query) === "quiz")'));
  });

  it("checks the deployment before it turns a remembered buzzer back on", () => {
    expect(body).toMatch(/setBuzzerEnabled\(form\.buzzer && isBuzzerConfigured\(\)\);/);
  });

  it("reads the clip lengths and the sample counts from where they are validated", () => {
    expect(body).not.toMatch(/const CLIP_DURATIONS\b/);
    expect(body).not.toMatch(/const MIXED_SAMPLE_COUNTS\b/);
    expect(body).toMatch(/maxLength=\{PLAYER_NAME_MAX\}/);
    expect(body).not.toMatch(/maxLength=\{\d+\}/);
  });
});

describe("Start fresh", () => {
  const body = code(read(HOME));
  const fresh = body.slice(body.indexOf("function startFresh()"), body.indexOf("function pickPlaylist("));

  it("forgets, and puts back the form this visit would have opened on without the memory", () => {
    expect(fresh).toMatch(/forgetSetup\(\);/);
    expect(fresh).toMatch(/applySetup\(initialSetup\(arrivalRef\.current, null\)\);/);
    expect(fresh).toMatch(/setRecentPlaylists\(\[\]\);/);
    expect(fresh).toMatch(/setRecalled\(false\);/);
    // And the error with it, memo included, or the next Start on the same
    // link replays a refusal from before the form was cleared.
    expect(fresh).toMatch(/setFailure\(null\);/);
    expect(fresh).toMatch(/lastRejectedRef\.current = null;/);
  });

  it("is withheld while a room is open or a start is in flight, without moving the form", () => {
    // It can turn the buzzer off, and a room with phones in it is not
    // something a text link should be able to throw away.
    expect(body).toMatch(
      /\{recalled && \(\s*<RecallNote onStartFresh=\{startFresh\} locked=\{openedRoom !== null \|\| startBusy\} \/>\s*\)\}/
    );
    // Hidden in place rather than unmounted: taking the line away would move
    // the Start button by its height at the moment it is pressed.
    const note = code(read(ASSIST));
    expect(note).toMatch(/disabled=\{locked\}/);
    expect(note).toMatch(/style=\{locked \? \{ visibility: "hidden" \} : undefined\}/);
  });

  it("leaves the game counter and the loop's attribution alone", () => {
    expect(fresh).not.toMatch(/bumpHostGameCount|rememberLoopRef|removeStored|guesssong_host_games|guesssong_loop_ref/);
    const memory = read("lib/setup-memory.ts");
    const forget = memory.slice(memory.indexOf("export function forgetSetup()"));
    expect(forget.match(/removeStored\(/g) ?? []).toHaveLength(2);
    expect(forget).toMatch(/removeStored\(SETUP_MEMORY_KEY\);/);
    expect(forget).toMatch(/removeStored\(RECENT_PLAYLISTS_KEY\);/);
  });
});

describe("the setup source follows the link into the field", () => {
  const body = code(read(HOME));

  it("is written by every path that writes the field", () => {
    // Three writers: the restore, a chip, and the keyboard. A fourth that set
    // the link and not its source would report the previous one's.
    const writers = positions(body, "setPlaylistUrl(");
    expect(writers).toHaveLength(3);
    for (const at of writers) {
      const next = body.slice(at, at + 160);
      expect(next, next).toMatch(/^setPlaylistUrl\([^)]*\)+;\s*setLinkSource\(/);
    }
    expect(body).toMatch(/setPlaylistUrl\(e\.target\.value\);\s*setLinkSource\("typed"\);/);
    expect(body).toMatch(/setPlaylistUrl\(playlistUrlOf\(id\)\);\s*setLinkSource\(source\);/);
    expect(body).toMatch(/setPlaylistUrl\(form\.playlistUrl\);\s*setLinkSource\(form\.linkSource\);/);
  });

  it("names the chip it came from", () => {
    expect(body).toMatch(/onPick=\{\(playlist\) => pickPlaylist\(playlist\.id, "recent"\)\}/);
    expect(body).toMatch(/onPick=\{\(playlist\) => pickPlaylist\(playlist\.id, "starter"\)\}/);
  });

  it("is derived once, where the game is counted, and reaches both copies", () => {
    expect(body).toMatch(/const setupSource: SetupSource = mixed \? "mixed" : linkSource;/);
    expect(body).toMatch(/reportGameStart\(hostGameIndex, mixed, setupSource\);/);
    expect(body).toMatch(/setup_source: setupSource,/);
    // The three callers still say only which mixed route it was.
    expect(body).toMatch(/\.\.\.recordHostedStart\("room"\)/);
    expect(body).toMatch(/\.\.\.recordHostedStart\("phone"\)/);
    expect(body).toMatch(/\.\.\.recordHostedStart\(\)/);
  });

  it("types the GA4 param as the same closed union, and the route hands the source on", () => {
    expect(code(read("lib/analytics.ts"))).toMatch(/setup_source\?: SetupSource;/);
    expect(code(read("app/api/pulse/route.ts"))).toMatch(
      /recordGameStart\(event\.hostGameIndex, event\.mixed, event\.source\)/
    );
  });
});

describe("a refused link says what to do next", () => {
  const body = code(read(HOME));

  it("keeps the code beside the sentence, in state and in the memo", () => {
    expect(body).toMatch(/const \[failure, setFailure\] = useState<SetupFailure \| null>\(null\);/);
    expect(body).toMatch(/useRef<\{ key: string; failure: SetupFailure \} \| null>\(null\)/);
    expect(body).not.toMatch(/\bsetError\(/);
    expect(body).not.toMatch(/const \[error, setError\]/);
  });

  it("replays a remembered refusal whole, so the second press keeps the help", () => {
    expect(positions(body, "setFailure(rejected.failure);")).toHaveLength(2);
    expect(body).toMatch(
      /lastRejectedRef\.current = shouldRememberRejection\(e\)\s*\? \{ key: submissionKey, failure: failed \}\s*: null;/
    );
    expect(body).toMatch(
      /lastRejectedRef\.current = allFailuresFinal\s*\? \{ key: submissionKey, failure: failed \}\s*: null;/
    );
    // The key is still the exact string submitted, so editing the link asks again.
    expect(body).toMatch(/const submissionKey = `own:\$\{playlistUrl\}`;/);
  });

  it("renders the help inside the alert, under the sentence", () => {
    expect(body).toMatch(/const help = failure \? playlistHelp\(failure\.code, locale\) : null;/);
    expect(body).toMatch(
      /\{failure && \(\s*<div\s+role="alert"[\s\S]*?<p>\{failure\.message\}<\/p>\s*\{help && <PlaylistHelpLine help=\{help\} \/>\}\s*<\/div>\s*\)\}/
    );
  });

  it("opens the guide in a new tab, because the form is state and Back would empty it", () => {
    const assist = code(read(ASSIST));
    const link = assist.match(/<a className="help-link"[^>]*>/)?.[0] ?? "";
    expect(link).toMatch(/href=\{help\.href\}/);
    expect(link).toMatch(/target="_blank"/);
    expect(link).toMatch(/rel="noopener"/);
    // And no link at all when there is nowhere to send them.
    expect(assist).toMatch(/\{help\.href && \(/);
  });
});

describe("the editorial warning", () => {
  const body = code(read(HOME));

  it("asks whether the id begins 37i9, not whether the text contains it", () => {
    expect(body).toMatch(/const isEditorial = isEditorialLink\(playlistUrl\);/);
    expect(body).not.toMatch(/includes\("37i9"\)/);
    expect(body).not.toContain("37i9");
  });

  it("no longer says these may work", () => {
    expect(body).not.toMatch(/may not work/);
    expect(body).toMatch(/\{isEditorial && <EditorialWarning warning=\{editorialWarning\(locale\)\} \/>\}/);
  });
});

describe("the chips", () => {
  const body = code(read(HOME));
  const assist = read(ASSIST);

  it("shows recent playlists under the field, in Single Playlist mode only", () => {
    const single = body.slice(
      body.indexOf('{setupMode === "single" && ('),
      body.indexOf('{setupMode === "mixed" && mixedSubMode === "phone" && (')
    );
    expect(single).toMatch(/<PlaylistChips\s+label="Recent"\s+playlists=\{recentPlaylists\}/);
    expect(single.indexOf("<PlaylistChips")).toBeGreaterThan(single.indexOf('className={`url-input'));
    expect(positions(body, 'label="Recent"')).toHaveLength(1);
  });

  it("lights the chip whose playlist is in the field", () => {
    expect(body).toMatch(/const currentPlaylistId = playlistIdOf\(playlistUrl\);/);
    expect(body).toMatch(/currentId=\{currentPlaylistId\}/);
  });

  it("keeps them to one row, so five cost the Start button what one does", () => {
    // Wrapped, five playlist names are three rows on a 390px phone, and the
    // Start button goes below the fold for the host this was built for.
    const row = assist.match(/^\s*\.chip-row \{([^}]*)\}/m)?.[1] ?? "";
    expect(row).toMatch(/flex-wrap:\s*nowrap/);
    expect(row).toMatch(/overflow-x:\s*auto/);
    const chip = assist.match(/^\s*\.chip \{([^}]*)\}/m)?.[1] ?? "";
    expect(chip).toMatch(/flex:\s*0 0 auto/);
    expect(chip).toMatch(/max-width:\s*\d+px/);
    // The name is cut with an ellipsis rather than allowed to wrap the chip.
    expect(assist).toMatch(/\.chip-name,\s*\.chip-blurb \{[^}]*white-space:\s*nowrap[^}]*\}/);
  });

  it("puts the note above the card in the gap the header already leaves", () => {
    const note = assist.match(/^\s*\.recall-note \{([^}]*)\}/m)?.[1] ?? "";
    // Pulled up into the header's 32px margin: 12px of new height, not a row.
    expect(note).toMatch(/margin:\s*-20px 0 12px/);
    expect(body.indexOf("<RecallNote")).toBeLessThan(body.indexOf('className={`card '));
  });

  it("offers the starters in one of two places, and only through starterPlacement", () => {
    expect(body).toMatch(/\{starterPlace === "field" && starterChips\}/);
    expect(body).toMatch(/\{starterPlace === "refusal" && starterChips\}/);
    expect(positions(body, "starterChips}")).toHaveLength(2);
    expect(positions(body, "STARTER_PLAYLISTS")).toHaveLength(2); // the import, and the one list of chips
    expect(body).toMatch(/failureCode: failure\?\.code \?\? null,/);
    expect(body).toMatch(/recentCount: recentPlaylists\.length,/);
    // Under the box means after it.
    expect(body.indexOf('{starterPlace === "refusal"')).toBeGreaterThan(body.indexOf('role="alert"'));
  });

  it("renders nothing at all for an empty list", () => {
    expect(code(assist)).toMatch(/if \(playlists\.length === 0\) return null;/);
  });
});
