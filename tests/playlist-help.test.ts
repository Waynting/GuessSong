// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AppError,
  ERROR_LOCALES,
  ERROR_MESSAGES,
  errorMessage,
  isDeterministicPlaylistFailure,
  type AppErrorCode,
} from "@/lib/error-messages";
import { getGuide } from "@/lib/guides";
import { PLAYLIST_REFUSAL_CODES } from "@/lib/loop-stats";
import {
  PLAYLIST_GUIDE_SLUG,
  PLAYLIST_HELP_BY_CODE,
  PLAYLIST_HELP_TOPICS,
  editorialWarning,
  failureFor,
  failureOf,
  isPermanentRefusal,
  playlistHelp,
  playlistHelpHref,
  playlistHelpTopic,
  type PlaylistHelpTopic,
} from "@/lib/playlist-help";

/**
 * What a refused host is told to do next.
 *
 * The failure this file guards is a silent one in both directions. A
 * permanent refusal with no entry renders exactly as it did before — a red
 * box, one sentence, no way forward — and nothing on screen says an entry is
 * missing. A throttling code *with* an entry tells a host whose playlist was
 * always fine to go and change it. Neither breaks a build.
 */

const ALL_CODES = Object.keys(ERROR_MESSAGES) as AppErrorCode[];

/**
 * The refusals that are about an empty field rather than a link. There is
 * nothing to look up about a link that has not been pasted.
 */
const NOTHING_PASTED: AppErrorCode[] = ["missing_playlist_url", "playlist_url_required"];

/**
 * Every code that says the link itself is the problem: the ones
 * `isDeterministicPlaylistFailure` names, plus anything called
 * `playlist_link_*` — the naming the per-kind refusals (album, track, artist)
 * use — so that one of those is caught here whether or not it has been added
 * to the deterministic set yet.
 */
const LINK_CODES = ALL_CODES.filter(
  (code) => isDeterministicPlaylistFailure(code) || code.startsWith("playlist_link_")
);

const TOPICS = Object.keys(PLAYLIST_HELP_TOPICS) as PlaylistHelpTopic[];

describe("which refusals get help", () => {
  it("covers every refusal that is the link's own fault", () => {
    // Adding one is a single line in PLAYLIST_HELP_BY_CODE:
    //   playlist_link_album: "wrong_link",
    const missing = LINK_CODES.filter(
      (code) => !NOTHING_PASTED.includes(code) && playlistHelpTopic(code) === null
    );
    expect(missing, `no help for: ${missing.join(", ")}`).toEqual([]);
  });

  it("covers the four refusals the server counts as permanent", () => {
    // `playlist_refused:<code>` in lib/loop-stats.ts — 2,535 of them in the
    // week this was written. These are the people it is for.
    for (const code of PLAYLIST_REFUSAL_CODES) {
      expect(playlistHelpTopic(code), code).not.toBeNull();
      expect(isPermanentRefusal(code), code).toBe(true);
    }
  });

  it("never offers help for a throttling code, or for one we do not understand", () => {
    // Help reads as "your link is the problem". For a spent quota that is the
    // old bug: a host sent off to make a public playlist public.
    const keys = Object.keys(PLAYLIST_HELP_BY_CODE) as AppErrorCode[];
    expect(keys.length).toBeGreaterThan(0);
    for (const code of keys) {
      expect(LINK_CODES, `${code} is not a refusal of the link`).toContain(code);
      expect(NOTHING_PASTED, `${code} is an empty field`).not.toContain(code);
    }
    for (const code of [
      "spotify_rate_limited",
      "spotify_cooldown",
      "spotify_quota_exhausted",
      "spotify_daily_budget_spent",
      "spotify_busy",
      "rate_limited_playlist",
      "playlist_load_failed",
      "mixed_playlists_failed",
      "storage_blocked",
      "server_error",
      "unknown",
    ] satisfies AppErrorCode[]) {
      expect(playlistHelpTopic(code), code).toBeNull();
      expect(playlistHelp(code, "en"), code).toBeNull();
      expect(isPermanentRefusal(code), code).toBe(false);
    }
  });

  it("names only codes that exist and topics that exist", () => {
    for (const [code, topic] of Object.entries(PLAYLIST_HELP_BY_CODE)) {
      expect(ALL_CODES, code).toContain(code);
      expect(TOPICS, `${code} → ${topic}`).toContain(topic);
    }
    // And no topic is written that nothing points at.
    const used = new Set(Object.values(PLAYLIST_HELP_BY_CODE));
    for (const topic of TOPICS) expect(used.has(topic), `${topic} is unused`).toBe(true);
  });

  it("is not fooled by what a plain object answers to", () => {
    for (const junk of ["constructor", "__proto__", "toString", "hasOwnProperty", "", " playlist_not_found", 7, null, undefined, {}]) {
      expect(playlistHelpTopic(junk), String(junk)).toBeNull();
      expect(isPermanentRefusal(junk), String(junk)).toBe(false);
    }
  });
});

describe("what the help says", () => {
  it("has a step and a label in both languages, written for each", () => {
    for (const topic of TOPICS) {
      const copy = PLAYLIST_HELP_TOPICS[topic];
      for (const text of [copy.step, copy.label]) {
        for (const locale of ERROR_LOCALES) {
          expect(text[locale].trim().length, `${topic}.${locale}`).toBeGreaterThan(0);
        }
        expect(text.zh, `${topic} is untranslated`).not.toBe(text.en);
        // Written natively: a Chinese line that is mostly Latin letters is an
        // English line that was left behind.
        expect(/[一-鿿]/.test(text.zh), `${topic}.zh has no Chinese in it`).toBe(true);
        expect(/[一-鿿]/.test(text.en), `${topic}.en has Chinese in it`).toBe(false);
      }
    }
  });

  it("leaves the arrow to the renderer and the full stop to the step", () => {
    for (const topic of TOPICS) {
      const { step, label } = PLAYLIST_HELP_TOPICS[topic];
      for (const locale of ERROR_LOCALES) {
        expect(label[locale], `${topic}.label.${locale}`).not.toMatch(/[→.。]\s*$/);
        expect(step[locale], `${topic}.step.${locale}`).toMatch(/[.。]$/);
      }
    }
  });

  it("uses Traditional Chinese, the way the rest of the site does", () => {
    // The Simplified forms of the characters these lines are built from:
    // 單 設 連 結 開 這 個 貼 進 麼 樣 為 複 選 長 裝 機 檔 換 會 裡.
    const simplified = /[单设连结开这个贴进么样为复选长装机档换会里]/;
    for (const topic of TOPICS) {
      const { step, label } = PLAYLIST_HELP_TOPICS[topic];
      for (const text of [step.zh, label.zh]) {
        expect(text, `${topic}: ${text}`).not.toMatch(simplified);
      }
    }
  });

  it("gives each refusal a different next step", () => {
    const steps = TOPICS.map((topic) => PLAYLIST_HELP_TOPICS[topic].step.en);
    expect(new Set(steps).size).toBe(steps.length);
  });

  it("renders in the language it is asked for", () => {
    for (const code of PLAYLIST_REFUSAL_CODES) {
      const topic = playlistHelpTopic(code) as PlaylistHelpTopic;
      for (const locale of ERROR_LOCALES) {
        expect(playlistHelp(code, locale)).toEqual({
          step: PLAYLIST_HELP_TOPICS[topic].step[locale],
          label: PLAYLIST_HELP_TOPICS[topic].label[locale],
          href: playlistHelpHref(topic),
        });
      }
    }
  });
});

describe("where the help points", () => {
  const guide = readFileSync(
    join(process.cwd(), "app/guides", PLAYLIST_GUIDE_SLUG, "page.tsx"),
    "utf8"
  );

  it("is a guide that exists", () => {
    // Through lib/guides.ts, which is what the route, the index and the
    // sitemap derive from. A retired slug would otherwise be a link to a 404
    // handed to someone who is already stuck.
    expect(getGuide(PLAYLIST_GUIDE_SLUG)).toBeDefined();
  });

  it("links every topic into that guide, relative, and nowhere else", () => {
    for (const topic of TOPICS) {
      const href = playlistHelpHref(topic);
      expect(href, topic).not.toBeNull();
      expect(href, topic).toMatch(new RegExp(`^/guides/${PLAYLIST_GUIDE_SLUG}(#[a-z][a-z0-9-]*)?$`));
    }
  });

  it("names no section the guide does not have", () => {
    // Every anchor is null today — the guide's headings carry no ids. When
    // they grow them and the table is filled in, this is what stops it
    // pointing at a heading that was since renamed: a link to a missing
    // anchor lands at the top of the page and says nothing.
    for (const topic of TOPICS) {
      const { anchor } = PLAYLIST_HELP_TOPICS[topic];
      if (anchor === null) continue;
      expect(guide, `${topic} → #${anchor}`).toContain(`id="${anchor}"`);
    }
  });

  it("covers, in the guide, what each topic sends a host there for", () => {
    // The labels promise these. If the guide is rewritten and drops one, the
    // link still works and the host still cannot find it.
    expect(guide).toMatch(/37i9/);
    expect(guide).toMatch(/make it public/i);
    expect(guide).toMatch(/\/album\//);
    expect(guide).toMatch(/playlist is empty/i);
  });
});

describe("the editorial warning", () => {
  it("says what the refusal will say, so the two cannot come to disagree", () => {
    for (const locale of ERROR_LOCALES) {
      const warning = editorialWarning(locale);
      expect(warning.notice).toBe(errorMessage("playlist_editorial", locale));
      expect(warning).toMatchObject(playlistHelp("playlist_editorial", locale) ?? {});
      expect(warning.step.length).toBeGreaterThan(0);
      expect(warning.href).not.toBeNull();
    }
  });

  it("is definite: nothing in it says the link may work", () => {
    // It used to read "may not work", over a refusal that happens every time.
    const { notice, step } = editorialWarning("en");
    expect(`${notice} ${step}`).not.toMatch(/\b(may|might|could|sometimes|usually)\b/i);
    expect(notice).toMatch(/can't|cannot/i);
    const zh = editorialWarning("zh");
    expect(`${zh.notice}${zh.step}`).not.toMatch(/可能|也許|或許|有時/);
  });

  it("says the way out: a playlist of your own, made public", () => {
    const { step } = editorialWarning("en");
    expect(step).toMatch(/your own/i);
    expect(step).toMatch(/public/i);
    const zh = editorialWarning("zh").step;
    expect(zh).toMatch(/自己/);
    expect(zh).toMatch(/公開/);
  });
});

describe("a failure as the page holds it", () => {
  it("keeps the code beside the sentence", () => {
    const refused = failureOf(new AppError("playlist_not_found"), "en", "playlist_load_failed");
    expect(refused).toEqual({
      code: "playlist_not_found",
      message: errorMessage("playlist_not_found", "en"),
    });
    expect(playlistHelp(refused.code, "en")).not.toBeNull();
  });

  it("renders in the reader's language and fills the placeholders", () => {
    expect(failureOf(new AppError("playlist_editorial"), "zh", "playlist_load_failed").message).toBe(
      errorMessage("playlist_editorial", "zh")
    );
    const throttled = failureOf(new AppError("spotify_rate_limited", { seconds: 42 }), "en", "playlist_load_failed");
    expect(throttled.code).toBe("spotify_rate_limited");
    expect(throttled.message).toBe(errorMessage("spotify_rate_limited", "en", { params: { seconds: 42 } }));
    expect(throttled.message).not.toContain("{seconds}");

    const short = failureFor("mixed_min_contributors", "en", { count: 2 });
    expect(short.code).toBe("mixed_min_contributors");
    expect(short.message).toContain("2");
    expect(short.message).not.toContain("{count}");
    expect(failureFor("playlist_url_required", "zh").message).toBe(errorMessage("playlist_url_required", "zh"));
  });

  it("never turns a throw with no code into advice about the link", () => {
    // A dropped connection is a TypeError. It takes the fallback as its code,
    // and the fallback the page passes is not a permanent refusal.
    for (const thrown of [new TypeError("Failed to fetch"), new Error("boom"), "a string", null, undefined, { code: "playlist_not_found" }]) {
      const failure = failureOf(thrown, "en", "playlist_load_failed");
      expect(failure.code).toBe("playlist_load_failed");
      expect(failure.message).toBe(errorMessage("playlist_load_failed", "en"));
      expect(playlistHelp(failure.code, "en")).toBeNull();
    }
  });
});
