// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PlaylistLinkCheck } from "@/lib/spotify-link";

/**
 * The hook behind the four forms that gate a button on the playlist field,
 * run for real.
 *
 * tests/spotify-link.test.ts pins the reading. Two things are left, and
 * both are here. One only a render can show: that a named link is reported
 * when the field *becomes* one, and not again on every keystroke and
 * re-render that leaves it one. The forms are client components vitest
 * cannot import, but the hook is a plain module, so a one-line component that
 * calls it is rendered under jsdom — the way tests/wake-lock.test.ts does it.
 * The other is that the four forms still call it, which is read off their
 * source at the bottom of this file.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const analytics = vi.hoisted(() => ({
  events: [] as Array<{ name: string; params: unknown }>,
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: (name: string, params: unknown) => {
    analytics.events.push({ name, params });
  },
}));

const { usePlaylistLinkCheck } = await import("@/lib/use-playlist-link");

const ID = "3cEYpjA9oz9GiPac4AsH4n";

let root: Root;
let host: HTMLDivElement;
let seen: PlaylistLinkCheck | null = null;

function Field(props: { value: string; surface: "join" | "buzz" | "collector" | "room_panel" }) {
  seen = usePlaylistLinkCheck(props.value, props.surface);
  return null;
}

function type(value: string, surface: "join" | "buzz" | "collector" | "room_panel" = "join") {
  act(() => {
    root.render(createElement(Field, { value, surface }));
  });
  return seen as PlaylistLinkCheck;
}

beforeEach(() => {
  analytics.events = [];
  seen = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("usePlaylistLinkCheck", () => {
  it("hands back the classifier's reading of the field", () => {
    expect(type("")).toEqual({ submittable: false, problem: null, named: null });
    expect(type(`https://open.spotify.com/intl-ja/playlist/${ID}`).submittable).toBe(true);
    expect(type("https://spotify.link/AbCdEfG").submittable).toBe(true);
    expect(type(`https://open.spotify.com/album/${ID}`)).toEqual({
      submittable: false,
      problem: "playlist_link_album",
      named: "album",
    });
    expect(type("my party mix").problem).toBe("invalid_playlist_url");
  });

  it("reports a named link once, when the field becomes one", () => {
    type(`https://open.spotify.com/album/${ID}`);
    expect(analytics.events).toEqual([
      { name: "playlist_link_named", params: { surface: "join", link_kind: "album" } },
    ]);
  });

  it("does not report again for edits and re-renders that leave it the same kind", () => {
    type(`https://open.spotify.com/album/${ID}`);
    type(`https://open.spotify.com/album/${ID}?si=x`);
    type(`https://open.spotify.com/album/${ID}?si=xy`);
    type(`https://open.spotify.com/intl-ja/album/${ID}`);
    expect(analytics.events).toHaveLength(1);
  });

  it("reports the new kind when the field changes to another", () => {
    type(`https://open.spotify.com/album/${ID}`, "buzz");
    type(`https://open.spotify.com/track/${ID}`, "buzz");
    type("", "buzz");
    type(`https://open.spotify.com/track/${ID}`, "buzz");
    expect(analytics.events.map((e) => e.params)).toEqual([
      { surface: "buzz", link_kind: "album" },
      { surface: "buzz", link_kind: "track" },
      { surface: "buzz", link_kind: "track" },
    ]);
  });

  it("reports nothing for typing, for text, or for a link that works", () => {
    // `invalid_playlist_url` is what every half-typed address reads as, so
    // reporting it would count keystrokes. Only the three named kinds are
    // events — they cannot arise from anything but a whole, real link.
    const whole = `https://open.spotify.com/playlist/${ID}`;
    for (let end = 1; end <= whole.length; end += 1) type(whole.slice(0, end), "collector");
    type("my party mix", "collector");
    type("https://spotify.link/AbCdEfG", "collector");
    expect(analytics.events).toEqual([]);
  });

  it("never puts the link itself in the event", () => {
    type(`https://open.spotify.com/artist/${ID}?si=secret`, "room_panel");
    expect(JSON.stringify(analytics.events)).not.toContain(ID);
    expect(JSON.stringify(analytics.events)).not.toContain("secret");
  });
});

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
/** Source with its comments removed, so a rule can be quoted in prose. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the forms that gate a button on the link", () => {
  // Pinned on the source because vitest cannot import a .tsx module here.
  const SURFACES: Array<[string, string]> = [
    ["app/j/[code]/page.tsx", "join"],
    ["app/buzz/[code]/page.tsx", "buzz"],
    ["components/mixed-playlist-collector.tsx", "collector"],
    ["components/room-panel.tsx", "room_panel"],
  ];

  for (const [file, surface] of SURFACES) {
    describe(file, () => {
      const source = code(read(file));

      it("has no reading of its own", () => {
        // `includes("spotify.com/playlist")` turned away `/intl-ja/playlist/…`
        // and the old `/user/…/playlist/…`, both of which the server loads.
        expect(source).not.toMatch(/includes\(\s*["'`][^"'`]*spotify/);
        expect(source).not.toMatch(/spotify:playlist/);
        expect(source).not.toMatch(/\.(match|test|search)\([^)]*playlist/i);
      });

      it("asks the classifier, under its own name", () => {
        expect(source).toMatch(
          new RegExp(`usePlaylistLinkCheck\\(\\s*\\w+,\\s*"${surface}"\\s*\\)`)
        );
      });

      it("gates its button on what the server would accept", () => {
        expect(source).toMatch(/\.submittable/);
      });

      it("renders the reason from the message table, never a sentence of its own", () => {
        expect(source).toMatch(/errorMessage\(\s*\w+\.problem,\s*locale\s*\)/);
      });
    });
  }

  it("keeps the hook thin — the reading is in lib/spotify-link.ts, where the suite reaches it", () => {
    const hook = code(read("lib/use-playlist-link.ts"));
    expect(hook).toMatch(/checkPlaylistLink\(/);
    expect(hook).not.toMatch(/RegExp|\.match\(|\.test\(|includes\(/);
    // Reported when the field becomes a named link, not on every keystroke.
    expect(hook).toMatch(/useEffect\(\(\) => \{[\s\S]*?playlist_link_named[\s\S]*?\}, \[named, surface\]\)/);
  });
});
