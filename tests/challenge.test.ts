import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Track } from "@/types";
import {
  CHALLENGE_STEPS,
  CHALLENGE_VERDICTS,
  SEED_MAX,
  challengeBanner,
  challengeButtonLabel,
  challengeLandingQuery,
  challengeResultLine,
  challengeShareText,
  challengeShareUrl,
  challengeVerdict,
  encodeChallengeToken,
  freshSeed,
  isChallengeRef,
  isSeed,
  parseChallengeArrival,
  parseChallengeToken,
  seededRandom,
  soloOrderMaxScore,
  type ChallengeDeal,
} from "@/lib/challenge";
import { pickSpread, shuffle } from "@/lib/shuffle";
import { buildOrderRounds, readArrangement, trueOrder, usableOrderTracks } from "@/lib/order-game";
import { buildGamePayload, parseGamePayload } from "@/lib/game-session";
import { initialSetup, type RememberedSetup } from "@/lib/setup-memory";
import { whoFromSetup } from "@/lib/who-playing";
import { LOOP_SURFACES } from "@/lib/loop-links";
import { parsePulse } from "@/lib/pulse";
import { playableUrlOf } from "@/lib/playlist-ref";

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

const { recordGameStart, recordChallenge, __resetLivenessForTests } = await import("@/lib/loop-stats");
const { handleLoopHit } = await import("@/lib/loop-redirect");

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const metrics = () => kv.incrs.filter((k) => !k.endsWith(":live")).map((k) => k.replace("loop:stats:2026-11-17:", ""));

const PLAYLIST = "7axyIwzJZsCS6M9PlwQp1U";
const ALBUM = "4aawyAB9vmqN3uQ7FjRGTy";

const DEAL: ChallengeDeal = { ref: PLAYLIST, seed: 123456789, score: 7, max: 12, count: 20 };

function tracks(n: number): Track[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    name: `Song ${i}`,
    artists: [`Artist ${i % 7}`],
    durationMs: 200000,
    createdAt: "",
    albumName: `Album ${i % 11}`,
    releaseDate: `${1960 + (i % 60)}-01-01`,
    releaseDatePrecision: "day",
  }));
}

/** The setup page's solo order start, step for step (app/page.tsx). */
function dealFor(list: Track[], seed: number | undefined, count: number) {
  const random = seed === undefined ? undefined : seededRandom(seed);
  const shuffled = shuffle(list, random);
  const eligible = usableOrderTracks(shuffled);
  return pickSpread(eligible, count, random);
}

beforeEach(() => {
  kv.incrs = [];
  __resetLivenessForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the seed: same seed, same deal", () => {
  it("seededRandom is deterministic over its seed and stays in [0, 1)", () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const first = Array.from({ length: 1000 }, () => a());
    expect(Array.from({ length: 1000 }, () => b())).toEqual(first);
    expect(first.every((x) => x >= 0 && x < 1)).toBe(true);
    const c = seededRandom(43);
    expect(Array.from({ length: 10 }, () => c())).not.toEqual(first.slice(0, 10));
    // Pinned values: a change to the generator is a change to every deal a
    // link already in a chat names.
    const pinned = seededRandom(1);
    expect(pinned()).toBeCloseTo(0.6270739405881613, 12);
    expect(pinned()).toBeCloseTo(0.002735721180215478, 12);
  });

  it("deals the same rounds from the same playlist, seed and count — the friend's game is the challenger's", () => {
    const list = tracks(120);
    const one = buildOrderRounds(dealFor(list, DEAL.seed, 20)).rounds.map((r) => r.tracks.map((t) => t.id));
    const two = buildOrderRounds(dealFor([...list], DEAL.seed, 20)).rounds.map((r) => r.tracks.map((t) => t.id));
    expect(two).toEqual(one);
    expect(one.length).toBeGreaterThan(0);
    const other = buildOrderRounds(dealFor(list, DEAL.seed + 1, 20)).rounds.map((r) => r.tracks.map((t) => t.id));
    expect(other).not.toEqual(one);
  });

  it("leaves the unseeded shuffle as it was: Math.random, a permutation of the input", () => {
    const list = tracks(30);
    const spy = vi.spyOn(Math, "random");
    const out = shuffle(list, undefined);
    expect(spy).toHaveBeenCalled();
    expect(out).toHaveLength(list.length);
    expect(new Set(out.map((t) => t.id))).toEqual(new Set(list.map((t) => t.id)));
    spy.mockClear();
    pickSpread(list, 10, undefined);
    expect(spy).toHaveBeenCalled();
  });

  it("mints a uint32 seed, with getRandomValues and without it", () => {
    for (let i = 0; i < 50; i++) expect(isSeed(freshSeed())).toBe(true);
    vi.stubGlobal("crypto", undefined);
    for (let i = 0; i < 50; i++) expect(isSeed(freshSeed())).toBe(true);
    expect(isSeed(SEED_MAX)).toBe(true);
    for (const bad of [-1, SEED_MAX + 1, 1.5, Number.NaN, "5", null]) expect(isSeed(bad), String(bad)).toBe(false);
  });
});

describe("the link: build, forward, land", () => {
  it("round-trips the numbers through the token and refuses junk", () => {
    expect(parseChallengeToken(encodeChallengeToken(DEAL))).toEqual({ seed: 123456789, score: 7, max: 12, count: 20 });
    for (const junk of [
      null,
      "",
      "1.2.3",
      "1.2.3.4.5",
      "1.13.12.20", // score above max
      "1.0.0.20", // no max
      "4294967296.1.2.20", // seed past uint32
      "1.1001.1001.20", // past the score cap
      "1.2.3.0", // no songs
      "1.2.3.501", // past the song ceiling
      "-1.2.3.4",
      "1.2.3.4x",
      "0x1.2.3.4",
      "1e3.2.3.4",
      " 1.2.3.4",
    ]) {
      expect(parseChallengeToken(junk), String(junk)).toBeNull();
    }
  });

  it("shares the counting redirect's URL with the ref and the token, and no name", () => {
    const url = new URL(challengeShareUrl(DEAL));
    expect(url.pathname).toBe("/r/challenge");
    expect([...url.searchParams.keys()].sort()).toEqual(["c", "p"]);
    expect(url.searchParams.get("p")).toBe(PLAYLIST);
    expect(url.searchParams.get("c")).toBe("123456789.7.12.20");
  });

  it("forwards a valid challenge through /r/challenge to a form that reads it back", async () => {
    for (const ref of [PLAYLIST, `album:${ALBUM}`, `artist:${ALBUM}`]) {
      const deal = { ...DEAL, ref };
      const shared = new URL(challengeShareUrl(deal));
      const outcome = await handleLoopHit("challenge", true, shared.searchParams);
      expect(outcome.counted).toBe(true);
      const landing = new URL(outcome.destination, "https://www.guessong.app");
      expect(landing.pathname).toBe("/");
      expect(landing.searchParams.get("ref")).toBe("challenge");
      expect(landing.searchParams.get("playlist")).toBe(playableUrlOf(ref));
      expect(parseChallengeArrival(landing.searchParams)).toEqual(deal);
    }
    expect(metrics()).toEqual(["click:challenge", "click:challenge", "click:challenge"]);
  });

  it("forwards for the challenge surface only, and drops junk while still redirecting and counting", async () => {
    const good = new URL(challengeShareUrl(DEAL)).searchParams;
    for (const surface of LOOP_SURFACES.filter((s) => s !== "challenge")) {
      const { destination } = await handleLoopHit(surface, true, good);
      expect(destination, surface).not.toMatch(/challenge=|playlist=/);
    }
    const junk = [
      "p=37i9dQZF1DXcBWIGoYBM5M&c=1.2.3.4", // editorial
      "p=short&c=1.2.3.4",
      `p=${PLAYLIST}&c=1.9.3.4`,
      `p=${PLAYLIST}`,
      `c=1.2.3.4`,
      `p=album:${ALBUM}:x&c=1.2.3.4`,
      `p=${PLAYLIST}&c=1.2.3.4&playlist=https://evil.example/`,
    ];
    for (const q of junk.slice(0, -1)) {
      kv.incrs = [];
      const outcome = await handleLoopHit("challenge", true, new URLSearchParams(q));
      expect(outcome.destination, q).toBe("/?ref=challenge");
      expect(metrics(), q).toEqual(["click:challenge"]);
    }
    // Valid fields are rebuilt, never passed through: a smuggled param stays behind.
    const smuggled = await handleLoopHit("challenge", true, new URLSearchParams(junk[junk.length - 1]));
    expect(smuggled.destination).not.toContain("evil");
    expect(new URL(smuggled.destination, "https://x.test").searchParams.getAll("playlist")).toEqual([
      playableUrlOf(PLAYLIST),
    ]);
    // Throttled: lands with the challenge, uncounted.
    const throttled = await handleLoopHit("challenge", false, good);
    expect(throttled.destination).toContain("challenge=");
    expect(throttled.counted).toBe(false);
  });

  it("reads a ref only as the classifier reads it back", () => {
    expect(isChallengeRef(PLAYLIST)).toBe(true);
    expect(isChallengeRef(`album:${ALBUM}`)).toBe(true);
    for (const bad of ["37i9dQZF1DXcBWIGoYBM5M", "x".repeat(22) + "y", "track:" + ALBUM, "", null, 5]) {
      expect(isChallengeRef(bad), String(bad)).toBe(false);
    }
    expect(challengeLandingQuery(new URLSearchParams(`p=${PLAYLIST}&c=1.2.3.4`))).toBe(
      new URLSearchParams({ playlist: playableUrlOf(PLAYLIST), challenge: "1.2.3.4" }).toString()
    );
    // The setup page re-validates its own URL: a token without a playlist is nothing.
    expect(parseChallengeArrival(new URLSearchParams("challenge=1.2.3.4"))).toBeNull();
  });
});

describe("the payload carries the seed, the ref and the score, and repairs them", () => {
  const base = {
    tracks: tracks(8),
    players: [{ name: "You", score: 0 }],
    playlistName: "P",
    clipDuration: 15,
    playlistSource: "own" as const,
    mode: "order" as const,
  };

  it("round-trips through storage", () => {
    const payload = buildGamePayload({ ...base, seed: 99, playlistRef: PLAYLIST, challenge: { score: 7, max: 12 } });
    const back = parseGamePayload(JSON.stringify(payload));
    expect(back).toMatchObject({ seed: 99, playlistRef: PLAYLIST, challenge: { score: 7, max: 12 } });
  });

  it("drops what is invalid and never the game", () => {
    const stored = JSON.stringify({
      ...buildGamePayload(base),
      seed: -4,
      playlistRef: "../etc",
      challenge: { score: 13, max: 12 },
    });
    const back = parseGamePayload(stored);
    expect(back).not.toBeNull();
    expect(back?.tracks).toHaveLength(8);
    expect(back).not.toHaveProperty("seed");
    expect(back).not.toHaveProperty("playlistRef");
    expect(back).not.toHaveProperty("challenge");
    for (const seed of ["5", 1.5, SEED_MAX + 1, null]) {
      expect(parseGamePayload(JSON.stringify({ ...buildGamePayload(base), seed })), String(seed)).not.toHaveProperty("seed");
    }
    // A payload from before the fields reads exactly as it did.
    expect(parseGamePayload(JSON.stringify(buildGamePayload(base)))).toEqual(
      parseGamePayload(JSON.stringify(buildGamePayload(base)))
    );
    expect(Object.keys(buildGamePayload(base))).not.toContain("seed");
  });
});

describe("the setup page opens a challenge as the order game, alone, on its playlist", () => {
  const remembered: RememberedSetup = {
    playlistUrl: playableUrlOf("1AbCdEfGhIjKlMnOpQrStU"),
    playlistName: "Mine",
    players: ["Amy", "Ben", "Cat"],
    clipDuration: 20,
    songCount: 30,
    mode: "mixed",
    mixedSubMode: "phone",
    sampledPerPlayer: 8,
    buzzer: true,
    playStyle: "guess",
  };

  it("outranks the memory and the rest of the URL", () => {
    const form = initialSetup(
      { sharedUrl: playableUrlOf(PLAYLIST), requestedMode: "mixed", challenge: DEAL },
      remembered
    );
    expect(form).toMatchObject({
      setupMode: "single",
      playlistUrl: playableUrlOf(PLAYLIST),
      linkSource: "shared",
      playStyle: "order",
      buzzer: false,
      songCount: { count: 20, field: "" },
    });
    expect(whoFromSetup(form)).toBe("solo");
    expect(form.players.filter((p) => p.trim())).toEqual(["Amy"]);
  });

  it("changes nothing for an arrival without one", () => {
    expect(initialSetup({ sharedUrl: null, requestedMode: null, challenge: null }, remembered)).toEqual(
      initialSetup({ sharedUrl: null, requestedMode: null }, remembered)
    );
  });
});

describe("the counters", () => {
  it("parses the start flag as a literal true and the challenge steps as a closed set", () => {
    expect(parsePulse({ kind: "game_started", hostGameIndex: 1, mode: "order", players: "p1", challenge: true })).toMatchObject({
      challenge: true,
    });
    expect(parsePulse({ kind: "game_started", hostGameIndex: 1, challenge: "yes" })).toEqual({
      kind: "game_started",
      hostGameIndex: 1,
    });
    for (const step of CHALLENGE_STEPS) expect(parsePulse({ kind: "challenge", step })).toEqual({ kind: "challenge", step });
    for (const step of ["started", "share:maybe", "won:x", "", null]) {
      expect(parsePulse({ kind: "challenge", step }), String(step)).toBeNull();
    }
  });

  it("writes challenge:started only for an order game of one", async () => {
    await recordGameStart(1, { mode: "order", players: "p1", challenge: true });
    expect(metrics()).toContain("challenge:started");
    for (const [mode, players] of [
      ["party", "p1"],
      ["order", "p2"],
      ["order", undefined],
      [undefined, "p1"],
    ] as const) {
      kv.incrs = [];
      await recordGameStart(1, { mode, players, challenge: true });
      expect(metrics(), `${mode} ${players}`).not.toContain("challenge:started");
      expect(metrics()).toContain("games");
    }
    kv.incrs = [];
    await recordGameStart(1, { mode: "order", players: "p1" });
    expect(metrics()).not.toContain("challenge:started");
  });

  it("writes challenge:<step> for every declared step and nothing else", async () => {
    for (const step of CHALLENGE_STEPS) {
      kv.incrs = [];
      await recordChallenge(step);
      expect(metrics()).toEqual([`challenge:${step}`]);
    }
    kv.incrs = [];
    await recordChallenge("started" as never);
    expect(metrics()).toEqual([]);
  });

  it("is printed by npm run stats, not left in Other counters", () => {
    const script = read("scripts/loop-stats.mjs");
    const rendered = script.match(/const RENDERED_PREFIXES = \[([^\]]*)\]/)?.[1] ?? "";
    expect(rendered).toContain('"challenge:"');
    expect(script).toMatch(/Challenge links/);
    for (const key of ["impression:challenge", "click:challenge", "challenge:started", "challenge:won", "challenge:lost", "challenge:tied"]) {
      expect(script).toContain(key);
    }
    expect(script).toMatch(/challenge:share:\$\{o\}/);
  });
});

describe("scores and words", () => {
  it("scores a solo round as the whole order plus the oldest on top", () => {
    const round = buildOrderRounds(tracks(4)).rounds[0];
    const best = readArrangement(trueOrder(round).map((t) => t.id), round);
    expect(best.exact && best.oldest).toBe(true);
    expect(soloOrderMaxScore(3)).toBe(12);
    expect(soloOrderMaxScore(-1)).toBe(0);
  });

  it("calls the result and words it without names", () => {
    expect(CHALLENGE_VERDICTS.map((v) => v)).toEqual(["won", "lost", "tied"]);
    expect(challengeVerdict(9, 7)).toBe("won");
    expect(challengeVerdict(5, 7)).toBe("lost");
    expect(challengeVerdict(7, 7)).toBe("tied");
    expect(challengeResultLine(9, 7)).toBe("You 9 · Your friend 7 — you win!");
    expect(challengeBanner(7, 12)).toBe("Your friend scored 7 of 12 on this playlist — beat it");
    expect(challengeButtonLabel(9, false)).toBe("Challenge a friend: beat my 9");
    expect(challengeShareText(9, 12)).toMatch(/9 of 12/);
  });
});

describe("the pages, by reading the source", () => {
  it("the setup page seeds a solo order start only, and passes the stream to both shuffles", () => {
    const page = code(read("app/page.tsx"));
    expect(page).toMatch(/const soloOrder = isOrder && who === "solo" && setupMode === "single";/);
    expect(page).toMatch(/const seed = soloOrder \? \(challengeFor \? challengeFor\.seed : freshSeed\(\)\) : undefined;/);
    expect(page).toMatch(/const random = seed === undefined \? undefined : seededRandom\(seed\);/);
    expect(page).toMatch(/const shuffled = shuffle\(data\.tracks as Track\[\], random\);/);
    expect(page).toMatch(/challengeFor \? challengeFor\.count : songCount\.count === "all" \? eligible\.length : songCount\.count,\s*random\s*\)/);
    expect(page).toMatch(/challengeFor \? \{ challenge: \{ score: challengeFor\.score, max: challengeFor\.max \} \} : \{\}/);
    expect(page).toMatch(/const arrivedChallenge = parseChallengeArrival\(query\);/);
    expect(page).toMatch(/challengeBanner\(challengeFor\.score, challengeFor\.max\)/);
    expect(page).toMatch(/\.\.\.\(challengeGame \? \{ challenge: true as const \} : \{\}\),/);
    // The room starts never draw a seed.
    expect(page.match(/seededRandom\(/g)).toHaveLength(1);
  });

  it("the order page offers the challenge to a solo seeded game and counts a friend's result once", () => {
    const page = code(read("app/order/page.tsx"));
    expect(page).toMatch(/\{solo && dealSource && players\[0\] && \(\s*<OrderChallenge/);
    expect(page).toMatch(/count: pool\.length,/);
    expect(page).toMatch(/max: soloOrderMaxScore\(rounds\.length\),/);
    const finished = page.slice(page.indexOf("function trackGameFinished"), page.indexOf("function nextRound"));
    expect(finished).toMatch(/if \(finishedTrackedRef\.current\) return;/);
    expect(finished).toMatch(/reportChallengeResult\(challengeVerdict\(players\[0\]\.score, against\.score\)\)/);
    expect(page.match(/reportChallengeResult\(/g)).toHaveLength(1);
  });

  it("the card reports its impression on mount and shares the counting redirect's URL, never the tab's", () => {
    const src = read("components/order-challenge.tsx");
    expect(src).toMatch(/reportLoopImpression\("challenge"\)/);
    expect(src).toMatch(/challengeShareUrl\(deal\)/);
    expect(src).toMatch(/reportChallengeShare\(outcome\)/);
    expect(src).toMatch(/className="btn-ghost compact"/);
    expect(code(src)).not.toMatch(/window\.location/);
  });

  it("the redirect route hands its query to the decision", () => {
    expect(read("app/r/[surface]/route.ts")).toMatch(/handleLoopHit\(surface, allowed, req\.nextUrl\.searchParams\)/);
  });
});
