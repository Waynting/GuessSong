// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NO_REFUSAL, noteFailure, noteStart, RECOVERY_STAGES } from "@/lib/refusal-recovery";
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
    // An album link is a wrong link, like a malformed one.
    expect(noteFailure(NO_REFUSAL, "playlist_link_album").report).toBe("wrong_link");
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

describe("the setup page's wiring", () => {
  const body = code(read("app/page.tsx"));

  it("sends every caught failure through showFailure, which notes it", () => {
    expect(body).not.toMatch(/failureOf\([^)]*\);[\s\S]{0,400}?\n\s*setFailure\(failed\)/);
    expect(body.match(/showFailure\(failed\)/g) ?? []).toHaveLength(2);
    const show = body.slice(body.indexOf("function showFailure("));
    expect(show.slice(0, 300)).toMatch(/noteFailure\(recoveryRef\.current, failed\.code\)/);
  });

  it("credits a recovery where every hosted start is counted", () => {
    const start = body.slice(body.indexOf("function recordHostedStart("));
    expect(start.slice(0, 600)).toMatch(/noteStart\(recoveryRef\.current, setupSource\)/);
  });
});
