// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NO_REFUSAL,
  noteFailure,
  noteStart,
  parseRecovery,
  RECOVERY_CARRY_MS,
  RECOVERY_STAGES,
  serializeRecovery,
} from "@/lib/refusal-recovery";
import { PLAYLIST_HELP_BY_CODE, PLAYLIST_HELP_TOPIC_NAMES, PLAYLIST_HELP_TOPICS } from "@/lib/playlist-help";
import { loopStatsKeys, recordRefusalRecovery, SETUP_SOURCES } from "@/lib/loop-stats";
import { parsePulse } from "@/lib/pulse";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("the rule", () => {
  it("counts the first permanent refusal on a page, by what the host was told", () => {
    const first = noteFailure(NO_REFUSAL, "playlist_not_found");
    expect(first.report).toBe("private");
    // A second refusal on the same page is the same stuck host.
    expect(noteFailure(first.state, "playlist_editorial").report).toBeNull();
    // A track link is a wrong link, like a malformed one — and so is an
    // album Spotify has not got, which has no "make it public" to offer.
    expect(noteFailure(NO_REFUSAL, "playlist_link_track").report).toBe("wrong_link");
    expect(noteFailure(NO_REFUSAL, "album_not_found").report).toBe("wrong_link");
  });

  it("does not count a failure that says nothing about the link", () => {
    for (const c of ["spotify_rate_limited", "spotify_quota_exhausted", "playlist_load_failed", "players_required", "unknown", "constructor", undefined]) {
      expect(noteFailure(NO_REFUSAL, c).report, String(c)).toBeNull();
    }
  });

  it("credits one start after a refusal, with how, and only one", () => {
    expect(noteStart(NO_REFUSAL, "typed").report).toBeNull();
    const refused = noteFailure(NO_REFUSAL, "playlist_editorial").state;
    const started = noteStart(refused, "starter");
    expect(started.report).toEqual({ topic: "editorial", via: "starter" });
    expect(noteStart(started.state, "typed").report).toBeNull();
  });

  it("keeps the topic list in step with the topics the help is written for", () => {
    expect([...PLAYLIST_HELP_TOPIC_NAMES].sort()).toEqual(Object.keys(PLAYLIST_HELP_TOPICS).sort());
    for (const topic of Object.values(PLAYLIST_HELP_BY_CODE)) {
      expect(PLAYLIST_HELP_TOPIC_NAMES).toContain(topic);
    }
  });
});

describe("the wire and the counters", () => {
  it("accepts refused with a topic, recovered with a topic and a source, and nothing else", () => {
    expect(parsePulse({ kind: "refusal_recovery", stage: "refused", topic: "private" })).toEqual({
      kind: "refusal_recovery", stage: "refused", topic: "private",
    });
    expect(parsePulse({ kind: "refusal_recovery", stage: "recovered", topic: "empty", via: "recent" })).toEqual({
      kind: "refusal_recovery", stage: "recovered", topic: "empty", via: "recent",
    });
    for (const body of [
      { kind: "refusal_recovery", stage: "refused", topic: "playlist_not_found" },
      { kind: "refusal_recovery", stage: "recovered", topic: "private" },
      { kind: "refusal_recovery", stage: "recovered", topic: "private", via: "__proto__" },
      { kind: "refusal_recovery", stage: "gave_up", topic: "private" },
    ]) {
      expect(parsePulse(body), JSON.stringify(body)).toBeNull();
    }
  });

  it("declares a key for every stage and topic, and every source a recovery can name", () => {
    const keys = loopStatsKeys("2026-10-01", []);
    for (const stage of RECOVERY_STAGES) {
      for (const topic of PLAYLIST_HELP_TOPIC_NAMES) {
        expect(keys.refusalRecovery[stage][topic]).toBe(`loop:stats:2026-10-01:refusal_recovery:${stage}:${topic}`);
      }
    }
    for (const s of SETUP_SOURCES) {
      expect(keys.refusalRecoveryVia[s]).toBe(`loop:stats:2026-10-01:refusal_recovery_via:${s}`);
    }
  });

  it("refuses a tail outside the closed sets rather than keying it", async () => {
    await expect(recordRefusalRecovery("refused", "nope" as never)).resolves.toBeUndefined();
  });

  it("is read by npm run stats, topic by topic and source by source", () => {
    const script = read("scripts/loop-stats.mjs");
    const rendered = script.match(/const RENDERED_PREFIXES = \[([^\]]*)\]/)?.[1] ?? "";
    expect(rendered).toContain('"refusal_recovery:"');
    expect(rendered).toContain('"refusal_recovery_via:"');
    for (const topic of PLAYLIST_HELP_TOPIC_NAMES) {
      expect(script, topic).toContain(`["${topic}",`);
    }
  });
});

describe("carried across a reload of the same tab", () => {
  const NOW = Date.parse("2026-10-17T12:00:00Z");

  it("round-trips an unrecovered refusal, and carries nothing once it recovered", () => {
    const refused = noteFailure(NO_REFUSAL, "playlist_not_found").state;
    expect(parseRecovery(serializeRecovery(refused, NOW), NOW + 60_000)).toEqual(refused);
    // Play Again returns to / in the same tab: the next refusal there is a new one.
    const recovered = noteStart(refused, "typed").state;
    expect(serializeRecovery(recovered, NOW)).toBeNull();
    const next = parseRecovery(serializeRecovery(recovered, NOW), NOW + 60_000);
    expect(noteFailure(next, "playlist_not_found").report).toBe("private");
  });

  it("so a reload's second refusal is not counted again, and its start is", () => {
    const before = noteFailure(NO_REFUSAL, "playlist_not_found").state;
    const afterReload = parseRecovery(serializeRecovery(before, NOW), NOW + 120_000);
    expect(noteFailure(afterReload, "playlist_not_found").report).toBeNull();
    expect(noteStart(afterReload, "typed").report).toEqual({ topic: "private", via: "typed" });
  });

  it("stores nothing for no refusal, and reads anything off as no refusal", () => {
    expect(serializeRecovery(NO_REFUSAL, NOW)).toBeNull();
    const old = serializeRecovery(noteFailure(NO_REFUSAL, "playlist_not_found").state, NOW);
    expect(parseRecovery(old, NOW + RECOVERY_CARRY_MS + 1)).toEqual(NO_REFUSAL);
    expect(parseRecovery(old, NOW - 1)).toEqual(NO_REFUSAL);
    // Each row is fresh, so the field it is about is the only thing wrong with it.
    for (const raw of [
      null,
      "",
      "{",
      "null",
      "[]",
      `{"refusedWith":"private"}`,
      ...["constructor", "__proto__", "toString", "nope"].map((t) => JSON.stringify({ refusedWith: t, at: NOW })),
      JSON.stringify({ refusedWith: "private", recovered: true, at: NOW }),
    ]) {
      expect(parseRecovery(raw, NOW), String(raw)).toEqual(NO_REFUSAL);
    }
    // Only a literal true is "recovered"; anything else reads as not recovered.
    expect(parseRecovery(JSON.stringify({ refusedWith: "private", recovered: "true", at: NOW }), NOW)).toEqual({
      refusedWith: "private",
      recovered: false,
    });
  });
});

describe("the setup page's wiring", () => {
  const body = code(read("app/page.tsx"));

  it("sends every caught failure through showFailure, which notes it", () => {
    expect(body).not.toMatch(/failureOf\([^)]*\);[\s\S]{0,400}?\n\s*setFailure\(failed\)/);
    expect(body.match(/showFailure\(failed\)/g) ?? []).toHaveLength(2);
    const show = body.slice(body.indexOf("function showFailure("));
    expect(show.slice(0, 300)).toMatch(/noteFailure\(recoveryRef\.current, failed\.code\)/);
  });

  it("reads the carried state on mount and writes it through sessionStorage's guard", () => {
    expect(body).toMatch(/recoveryRef\.current = parseRecovery\(readSessionStored\(RECOVERY_STORAGE_KEY\)\)/);
    expect(body).not.toMatch(/window\.sessionStorage/);
  });

  it("credits a recovery where every hosted start is counted", () => {
    const start = body.slice(body.indexOf("function recordHostedStart("));
    expect(start.slice(0, 600)).toMatch(/noteStart\(recoveryRef\.current, setupSource\)/);
  });
});
