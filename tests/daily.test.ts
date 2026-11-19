import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Track } from "@/types";
import {
  DAILY_EPOCH,
  DAILY_GAME_HREF,
  DAILY_PLAYLIST_ID,
  DAILY_SCORES,
  DAILY_SHARE_OUTCOMES,
  DAILY_SIZE,
  DAILY_STAGES,
  DAILY_STORAGE_KEY,
  dailyGrid,
  dailyNumber,
  dailyRound,
  dailySeed,
  dailyShareMessage,
  dailyShareText,
  gridEmoji,
  gridScore,
  isDayKey,
  parseDailyResult,
  parseDailyTag,
  pickDaily,
  recallDailyResult,
  rememberDailyResult,
  utcDayKey,
} from "@/lib/daily";
import { ORDER_PREFERRED_YEAR_GAP, releaseYear, trueOrder, usableOrderTracks } from "@/lib/order-game";
import { STARTER_PLAYLISTS } from "@/lib/starter-playlists";
import { buildGamePayload, parseGamePayload } from "@/lib/game-session";
import { LOOP_SURFACES, loopUrl } from "@/lib/loop-links";
import { parsePulse } from "@/lib/pulse";
import { SETUP_COPY, SETUP_LOCALES } from "@/lib/setup-copy";
import { ERROR_MESSAGES } from "@/lib/error-messages";
import { ORDER_COPY, ORDER_LOCALES } from "@/lib/order-copy";

const kv = vi.hoisted(() => ({ incrs: [] as string[] }));

vi.mock("@/lib/kv", () => ({
  dayBucket: () => "2026-11-20",
  getKvStore: async () => ({
    async incr(key: string) {
      kv.incrs.push(key);
      return 1;
    },
  }),
}));

const { recordDaily, recordDailyShare, __resetLivenessForTests } = await import("@/lib/loop-stats");

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const metrics = () => kv.incrs.filter((k) => !k.endsWith(":live")).map((k) => k.replace("loop:stats:2026-11-20:", ""));

let serial = 0;
function track(releaseDate: string | undefined, extra: Partial<Track> = {}): Track {
  serial++;
  return {
    id: `t${serial}`,
    name: `Song ${serial}`,
    artists: ["Artist"],
    albumName: "Album",
    albumImage: "",
    durationMs: 200000,
    ...(releaseDate ? { releaseDate } : {}),
    ...extra,
  } as Track;
}

/** A decades-shaped list: dated songs over many years, a few undatable ones. */
function decades(): Track[] {
  const out: Track[] = [];
  for (let y = 1961; y <= 2026; y += 1) out.push(track(`${y}-06-01`), track(`${y}`));
  out.push(track(undefined), track("2001-01-01", { albumCompilation: true }), track("0000"));
  return out;
}

beforeEach(() => {
  kv.incrs = [];
  __resetLivenessForTests();
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the day", () => {
  it("is the UTC date, whatever the time zone says", () => {
    // 23:30 in São Paulo on the 20th is already the 21st in UTC.
    expect(utcDayKey(new Date("2026-11-20T23:30:00-03:00"))).toBe("2026-11-21");
    // 08:00 in Taipei on the 21st is still the 20th in UTC.
    expect(utcDayKey(new Date("2026-11-21T08:00:00+08:00"))).toBe("2026-11-21");
    expect(utcDayKey(new Date("2026-11-21T07:59:59+08:00"))).toBe("2026-11-20");
  });

  it("numbers from 2026-11-19, the day it shipped, as #1, and refuses junk and the days before", () => {
    expect(DAILY_EPOCH).toBe("2026-11-19");
    expect(dailyNumber("2026-11-19")).toBe(1);
    expect(dailyNumber("2026-11-20")).toBe(2);
    expect(dailyNumber("2026-12-01")).toBe(13);
    expect(dailyNumber("2027-11-19")).toBe(366);
    expect(dailyNumber("2026-11-18")).toBeNull();
    for (const junk of ["", "2026-02-30", "2026-13-01", "20261120", "2026-11-20T00:00"]) {
      expect(dailyNumber(junk), junk).toBeNull();
      expect(isDayKey(junk), junk).toBe(false);
    }
  });

  it("seeds from the day string alone: stable, uint32, different day to day", () => {
    expect(dailySeed("2026-11-20")).toBe(dailySeed("2026-11-20"));
    const seeds = new Set<number>();
    for (let d = 20; d <= 30; d++) {
      const seed = dailySeed(`2026-11-${d}`);
      expect(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff).toBe(true);
      seeds.add(seed);
    }
    expect(seeds.size).toBe(11);
  });

  it("reads the decades starter, the order game's own list", () => {
    const decadesStarter = STARTER_PLAYLISTS.find((s) => s.starterKey === "decades");
    expect(decadesStarter?.id).toBe(DAILY_PLAYLIST_ID);
    expect(decadesStarter?.game).toBe("order");
    expect(DAILY_GAME_HREF).toBe("/order");
  });
});

describe("the pick", () => {
  it("is deterministic over the list and the seed, and always five usable distinct years", () => {
    const list = decades();
    for (let d = 20; d <= 30; d++) {
      const seed = dailySeed(`2026-11-${d}`);
      const a = pickDaily(list, seed);
      const b = pickDaily([...list], seed);
      expect(a).not.toBeNull();
      expect(a!.map((t) => t.id)).toEqual(b!.map((t) => t.id));
      expect(a).toHaveLength(DAILY_SIZE);
      expect(usableOrderTracks(a!)).toHaveLength(DAILY_SIZE);
      const years = a!.map((t) => releaseYear(t) as number);
      expect(new Set(years).size).toBe(DAILY_SIZE);
      // A wide list keeps the order game's preferred gap.
      for (const y of years) for (const z of years) if (y !== z) expect(Math.abs(y - z)).toBeGreaterThanOrEqual(ORDER_PREFERRED_YEAR_GAP);
      // And the round deals as exactly the stored five.
      expect(dailyRound(a!)?.tracks.map((t) => t.id)).toEqual(a!.map((t) => t.id));
    }
    expect(pickDaily(list, 1)!.map((t) => t.id)).not.toEqual(pickDaily(list, 2)!.map((t) => t.id));
  });

  it("steps the gap down to distinct years when the list is narrow", () => {
    const narrow = [2001, 2002, 2003, 2004, 2005, 2005, 2003].map((y) => track(`${y}`));
    const picked = pickDaily(narrow, 7);
    expect(picked).toHaveLength(5);
    expect(new Set(picked!.map((t) => releaseYear(t))).size).toBe(5);
  });

  it("refuses a list with fewer than five usable distinct years", () => {
    const four = [1990, 1991, 1992, 1993, 1993, 1990].map((y) => track(`${y}`));
    expect(pickDaily(four, 3)).toBeNull();
    const compilations = [1990, 1995, 2000, 2005, 2010].map((y) => (y === 2010 ? track(`${y}`, { albumCompilation: true }) : track(`${y}`)));
    expect(pickDaily(compilations, 3)).toBeNull();
    expect(pickDaily([], 3)).toBeNull();
  });

  it("deals a daily round only from exactly five usable distinct years", () => {
    expect(dailyRound([1990, 1995, 2000, 2005].map((y) => track(`${y}`)))).toBeNull();
    expect(dailyRound([1990, 1995, 2000, 2005, 2005].map((y) => track(`${y}`)))).toBeNull();
    expect(dailyRound([1990, 1995, 2000, 2005, undefined].map((y) => track(y ? `${y}` : undefined)))).toBeNull();
  });
});

describe("the grid and the share text", () => {
  const five = [2005, 1970, 2020, 1990, 1980].map((y) => track(`${y}`));
  const round = dailyRound(five)!;

  it("marks each slot by whether the card left there is the one that belongs", () => {
    const truth = trueOrder(round).map((t) => t.id);
    expect(dailyGrid(truth, round)).toEqual([true, true, true, true, true]);
    const swapped = [truth[1], truth[0], truth[2], truth[3], truth[4]];
    expect(dailyGrid(swapped, round)).toEqual([false, false, true, true, true]);
    // As dealt: 2005, 1970, 2020, 1990, 1980 against 1970, 1980, 1990, 2005, 2020.
    expect(dailyGrid(five.map((t) => t.id), round)).toEqual([false, false, false, false, false]);
  });

  it("writes Wordle-style squares and a k/5, and the link on its own line", () => {
    const grid = [true, true, false, true, true];
    expect(gridScore(grid)).toBe(4);
    expect(gridEmoji(grid)).toBe("🟩🟩⬛🟩🟩");
    expect(dailyShareText(12, grid)).toBe("GuessSong Daily #12 🟩🟩⬛🟩🟩 4/5");
    expect(dailyShareMessage(12, grid)).toBe(`GuessSong Daily #12 🟩🟩⬛🟩🟩 4/5\n${loopUrl("daily")}`);
    expect(loopUrl("daily")).toMatch(/\/r\/daily$/);
  });

  it("shares in the game's language with the grid and #N k/5 unchanged", () => {
    const grid = [true, true, false, true, true];
    expect(dailyShareText(12, grid, "pt")).toBe("GuessSong Desafio #12 🟩🟩⬛🟩🟩 4/5");
    expect(dailyShareMessage(12, grid, "pt")).toBe(`GuessSong Desafio #12 🟩🟩⬛🟩🟩 4/5\n${loopUrl("daily")}`);
    expect(dailyShareText(12, grid, "pt").slice(-16)).toBe(dailyShareText(12, grid).slice(-16));
  });

  it("puts the Game Over card's words in the order page's table, in every language", () => {
    for (const locale of ORDER_LOCALES) {
      const d = ORDER_COPY[locale].daily;
      expect(d.title(3), locale).toMatch(/#3/);
      expect(d.scoreLine(4, 5), locale).toMatch(/4\/5/);
      for (const line of [d.body, d.share, d.copied, d.tomorrow]) expect(line.length, locale).toBeGreaterThan(0);
    }
    expect(ORDER_COPY.en.daily.title(3)).toBe("Daily #3");
    expect(ORDER_COPY.pt.daily.share).not.toBe(ORDER_COPY.en.daily.share);
    expect(ORDER_COPY.pt.daily.body).not.toBe(ORDER_COPY.en.daily.body);
  });
});

describe("the payload", () => {
  const five = [2005, 1970, 2020, 1990, 1980].map((y) => track(`${y}`));
  const base = {
    tracks: five,
    players: [{ name: "You", score: 0 }],
    playlistName: "Daily #1",
    clipDuration: 15,
    playlistSource: "own" as const,
    mode: "order" as const,
  };

  it("round-trips a valid daily tag", () => {
    const payload = buildGamePayload({ ...base, daily: { day: "2026-11-21", number: 3 }, locale: "pt" });
    expect(payload.daily).toEqual({ day: "2026-11-21", number: 3 });
    const parsed = parseGamePayload(JSON.stringify(payload));
    expect(parsed?.daily).toEqual({ day: "2026-11-21", number: 3 });
    expect(parsed?.locale).toBe("pt");
  });

  it("drops a bad tag and keeps the game", () => {
    for (const daily of [
      { day: "2026-11-21", number: 4 },
      { day: "2026-11-18", number: 0 },
      { day: "nope", number: 1 },
      { number: 1 },
      "2026-11-21",
      42,
      null,
    ]) {
      const parsed = parseGamePayload(JSON.stringify({ ...base, daily }));
      expect(parsed, JSON.stringify(daily)).not.toBeNull();
      expect(parsed!.daily).toBeUndefined();
      expect(parsed!.tracks).toHaveLength(5);
      expect(parsed!.mode).toBe("order");
    }
    expect(parseDailyTag({ day: "2026-11-19", number: 1 })).toEqual({ day: "2026-11-19", number: 1 });
    expect(buildGamePayload({ ...base, daily: { day: "2026-11-20", number: 9 } }).daily).toBeUndefined();
  });
});

describe("once a day per device", () => {
  const result = { day: "2026-11-21", grid: [true, false, true, true, false], score: 3 };

  it("remembers the day's result and gives it back for that day only", () => {
    rememberDailyResult(result);
    expect(JSON.parse(window.localStorage.getItem(DAILY_STORAGE_KEY)!)).toEqual(result);
    expect(recallDailyResult("2026-11-21")).toEqual(result);
    expect(recallDailyResult("2026-11-22")).toBeNull();
  });

  it("repairs what it reads: the score is recounted, junk is no result", () => {
    expect(parseDailyResult(JSON.stringify({ ...result, score: 5 }))?.score).toBe(3);
    for (const junk of [
      null,
      "",
      "{",
      "[]",
      JSON.stringify({ ...result, grid: [true, false] }),
      JSON.stringify({ ...result, grid: [1, 0, 1, 1, 0] }),
      JSON.stringify({ ...result, day: "2026-11-18" }),
      JSON.stringify({ ...result, day: 20261121 }),
    ]) {
      expect(parseDailyResult(junk), String(junk)).toBeNull();
    }
  });

  it("never throws when the browser refuses storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => rememberDailyResult(result)).not.toThrow();
    expect(recallDailyResult("2026-11-21")).toBeNull();
  });
});

describe("the counters", () => {
  it("records every stage, and a finish with its score, in closed sets", async () => {
    expect([...DAILY_STAGES]).toEqual(["shown", "started", "finished", "repeat_view"]);
    for (const stage of ["shown", "started", "repeat_view"] as const) {
      kv.incrs = [];
      await recordDaily(stage);
      expect(metrics()).toEqual([`daily:${stage}`]);
    }
    for (const score of DAILY_SCORES) {
      kv.incrs = [];
      await recordDaily("finished", score);
      expect(metrics().sort()).toEqual(["daily:finished", `daily_score:${score}`]);
    }
    kv.incrs = [];
    await recordDaily("finished", 6 as never);
    expect(metrics()).toEqual(["daily:finished"]);
    kv.incrs = [];
    await recordDaily("opened" as never);
    await recordDaily("shown", 3 as never);
    expect(metrics()).toEqual(["daily:shown"]);
  });

  it("records the share outcomes and nothing else", async () => {
    for (const outcome of DAILY_SHARE_OUTCOMES) {
      kv.incrs = [];
      await recordDailyShare(outcome);
      expect(metrics()).toEqual([`daily_share:${outcome}`]);
    }
    kv.incrs = [];
    await recordDailyShare("posted" as never);
    expect(metrics()).toEqual([]);
  });

  it("parses the pulses as closed sets: a finish needs its score", () => {
    expect(parsePulse({ kind: "daily", stage: "shown" })).toEqual({ kind: "daily", stage: "shown" });
    expect(parsePulse({ kind: "daily", stage: "repeat_view" })).toEqual({ kind: "daily", stage: "repeat_view" });
    expect(parsePulse({ kind: "daily", stage: "finished", score: 4 })).toEqual({ kind: "daily", stage: "finished", score: 4 });
    expect(parsePulse({ kind: "daily", stage: "finished" })).toBeNull();
    expect(parsePulse({ kind: "daily", stage: "finished", score: 6 })).toBeNull();
    expect(parsePulse({ kind: "daily", stage: "finished", score: "4" })).toBeNull();
    expect(parsePulse({ kind: "daily", stage: "tapped" })).toBeNull();
    expect(parsePulse({ kind: "daily_share", outcome: "copied" })).toEqual({ kind: "daily_share", outcome: "copied" });
    expect(parsePulse({ kind: "daily_share", outcome: "posted" })).toBeNull();
    expect(parsePulse({ kind: "loop_impression", surface: "daily" })).toEqual({ kind: "loop_impression", surface: "daily" });
    expect(LOOP_SURFACES).toContain("daily");
  });

  it("routes both pulses to their recorders", () => {
    const route = read("app/api/pulse/route.ts");
    expect(route).toMatch(/case "daily":\s*await recordDaily\(event\.stage, event\.stage === "finished" \? event\.score : undefined\);/);
    expect(route).toMatch(/case "daily_share":\s*await recordDailyShare\(event\.outcome\);/);
  });

  it("is printed by npm run stats in its own block, not left in Other counters", () => {
    const script = read("scripts/loop-stats.mjs");
    const rendered = script.match(/const RENDERED_PREFIXES = \[([^\]]*)\]/)?.[1] ?? "";
    for (const prefix of ['"daily:"', '"daily_score:"', '"daily_share:"']) expect(rendered).toContain(prefix);
    expect(script).toMatch(/\\nDaily challenge {2}shown/);
    for (const key of ["daily:shown", "daily:started", "daily:finished", "daily:repeat_view", "impression:daily", "click:daily"]) {
      expect(script).toContain(`"${key}"`);
    }
    expect(script).toMatch(/daily_score:\$\{n\}/);
    expect(script).toMatch(/daily_share:\$\{o\}/);
  });
});

describe("the setup card, by reading the source", () => {
  const page = code(read("app/setup-page.tsx"));
  const start = page.slice(page.indexOf("async function startDaily()"), page.indexOf("async function shareDailyAgain()"));

  it("has its copy in every setup language, and an error code in every error language", () => {
    for (const locale of SETUP_LOCALES) {
      const d = SETUP_COPY[locale].daily;
      expect(d.title(4), locale).toMatch(/#4/);
      expect(d.done(4, 3, 5), locale).toMatch(/3\/5/);
      expect(d.tomorrow(5), locale).toMatch(/#5/);
      expect(d.sub.length, locale).toBeGreaterThan(0);
    }
    expect(SETUP_COPY.en.daily.title(12)).toBe("Today's challenge #12");
    expect(SETUP_COPY.en.daily.sub).toBe("Five songs, put them in order — the same for everyone today →");
    expect(SETUP_COPY.en.daily.player).toBe("You");
    expect(SETUP_COPY.pt.daily.player).toBe("Você");
    const msg = ERROR_MESSAGES.daily_unavailable;
    expect(msg.en).not.toBe(msg.zh);
    expect(msg.pt).not.toBe(msg.en);
    expect(msg.en).not.toMatch(/playlist|link/i);
  });

  it("reads the day and the result after mount, never in a useState initialiser", () => {
    expect(page).toMatch(/const \[dailyDay, setDailyDay\] = useState<string \| null>\(null\);/);
    expect(page).toMatch(/const \[dailyDone, setDailyDone\] = useState<DailyResult \| null>\(null\);/);
    const mount = page.slice(page.indexOf("setMounted(true);"), page.indexOf("const arrivedChallenge"));
    expect(mount).toMatch(/const today = utcDayKey\(\);\s*setDailyDay\(today\);\s*setDailyDone\(recallDailyResult\(today\)\);/);
    expect(page).not.toMatch(/useState\([^)]*(?:utcDayKey|recallDailyResult)/);
  });

  it("counts shown or repeat_view once per page load, exclusively", () => {
    expect(page).toMatch(/if \(!dailyDrawn \|\| dailyReportedRef\.current\) return;\s*dailyReportedRef\.current = true;\s*reportDaily\(dailyDone \? "repeat_view" : "shown"\);/);
    expect(page).toMatch(/const dailyDrawn = mounted && !challenge && dailyNo !== null;/);
  });

  it("loads through POST /api/playlist, refuses with a code, stores a one-player daily order game, then counts and goes", () => {
    expect(start).toMatch(/fetch\("\/api\/playlist", \{/);
    expect(start).toMatch(/JSON\.stringify\(\{ url: playableUrlOf\(DAILY_PLAYLIST_ID\) \}\)/);
    expect(start).toMatch(/throw apiError\(data, "playlist_load_failed"\)/);
    expect(start).toMatch(/const picked = pickDaily\(/);
    expect(start).toMatch(/if \(!picked\) throw new AppError\("daily_unavailable"\);/);
    expect(start).toMatch(/players: \[\{ name: copy\.daily\.player, score: 0 \}\]/);
    expect(start).toMatch(/mode: "order",/);
    expect(start).toMatch(/daily: \{ day, number \},/);
    // The Portuguese page's daily game speaks Portuguese, like every other start.
    expect(start).toMatch(/locale: gameLocaleFor\(pageLocale\),/);
    expect(start).toMatch(/playlistName: ORDER_COPY\[orderLocaleOf\(gameLocaleFor\(pageLocale\)\)\]\.daily\.playlistName\(number\),/);
    expect(start).not.toMatch(/seed:|playlistRef:|getPlaylistWithTracks|loadPlaylist/);
    const at = (s: string) => start.indexOf(s);
    expect(at("if (!saveGame(payload)) throw new AppError(\"storage_blocked\");")).toBeGreaterThan(at("if (!picked)"));
    expect(at('reportDaily("started");')).toBeGreaterThan(at("if (!saveGame(payload))"));
    expect(at("router.push(DAILY_GAME_HREF);")).toBeGreaterThan(at('reportDaily("started");'));
    // Errors are codes, rendered through the error table.
    expect(start).toMatch(/setDailyError\(describeError\(e, locale, "playlist_load_failed"\)\);/);
    // A day already played never deals again.
    expect(start).toMatch(/if \(!dailyDay \|\| dailyNo === null \|\| dailyDone \|\| dailyLoading \|\| loading\) return;/);
  });

  it("draws the done state as a share, never a second start", () => {
    const render = page.slice(page.indexOf("{dailyDrawn && dailyNo !== null && ("), page.indexOf("<Link href={QUIZ_SETUP_HREF}"));
    expect(render).toMatch(/\{dailyDone \? \(/);
    const done = render.slice(render.indexOf("{dailyDone ? ("), render.indexOf(") : ("));
    expect(done).toMatch(/onClick=\{shareDailyAgain\}/);
    expect(done).not.toMatch(/startDaily/);
    expect(done).toMatch(/copy\.daily\.tomorrow\(dailyNo \+ 1\)/);
    expect(render).toMatch(/className=\{`quiz-card daily-card/);
    expect(render).toMatch(/onClick=\{startDaily\}/);
  });
});

describe("the order page, by reading the source", () => {
  const page = code(read("app/order/page.tsx"));
  const finished = page.slice(page.indexOf("function trackGameFinished"), page.indexOf("function nextRound"));

  it("deals the stored five as one round, never re-shuffled", () => {
    expect(page).toMatch(/const dailyDeal = data\.daily \? dailyRound\(data\.tracks\) : null;/);
    expect(page).not.toMatch(/shuffle\(/);
    expect(page).toMatch(/setDaily\(dailyDeal && data\.daily \? data\.daily : null\);/);
  });

  it("stores and counts the result once, after the reveal, from the arrangement the reveal scored", () => {
    expect(finished).toMatch(/if \(finishedTrackedRef\.current\) return;/);
    expect(finished).toMatch(/if \(daily && phase === "revealed" && rounds\[0\]\) \{/);
    expect(finished).toMatch(/const grid = dailyGrid\(arrangedIds, rounds\[0\]\);/);
    expect(finished).toMatch(/rememberDailyResult\(finished\);/);
    expect(finished).toMatch(/reportDaily\("finished", finished\.score as DailyScore\);/);
    expect(page.match(/rememberDailyResult\(/g)).toHaveLength(1);
  });

  it("replaces the onward offers with the result card, and keeps music age and the streak", () => {
    expect(page).toMatch(/\{daily && dailyResult && <DailyResultCard number=\{daily\.number\} grid=\{dailyResult\.grid\} locale=\{pageLocale\} \/>\}/);
    expect(page).toMatch(/\{!daily && onward\.qr && <LoopQr caption=\{copy\.qrCaption\} \/>\}/);
    expect(page).toMatch(/\{!daily && onward\.mixedLink && \(/);
    expect(page).toMatch(/\{!daily && solo && against && players\[0\] && \(/);
    expect(page).toMatch(/\{ears && <MusicAgeCard age=\{ears\} room=\{!solo\} locale=\{pageLocale\} \/>\}/);
    expect(page).toMatch(/\{streakResult && \(/);
  });

  it("the result card reports its impression on mount and shares the counting redirect's URL", () => {
    const card = read("components/daily-result.tsx");
    expect(card).toMatch(/useEffect\(\(\) => \{\s*reportLoopImpression\("daily"\);\s*\}, \[\]\);/);
    expect(card).toMatch(/url: loopUrl\("daily"\)/);
    expect(card).toMatch(/dailyShareMessage\(number, grid, locale\)/);
    expect(card).toMatch(/const copy = ORDER_COPY\[locale\]\.daily;/);
    expect(card).toMatch(/reportDailyShare\(outcome\);/);
    expect(card).toMatch(/className="btn-ghost compact"/);
    expect(code(card)).not.toMatch(/window\.location/);
  });
});
