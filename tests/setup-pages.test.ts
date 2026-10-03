// @vitest-environment node
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { LOOP_CTA_LABEL, LOOP_FOOTER_LABEL, LOOP_QR_CAPTION } from "@/lib/loop-links";
import { QUIZ_SETUP_HREF } from "@/lib/setup-arrival";

/**
 * The two setup pages after the quiz left the party form, as far as the
 * suite can see them.
 *
 * `/` and `/quiz` are client components and vitest cannot import a `.tsx`
 * module here, so the forms themselves are verified in a browser. What this
 * file pins is the set of one-line invariants the split rests on, each of
 * which fails silently if undone: the page would still render, the build
 * would still pass, and a quiz link in an old group chat would land on the
 * party form again, or a quiz would start counting as a hosted game, or the
 * loop's footer would stop naming the product. Read the source, the way
 * tests/site-policy.test.ts and tests/quiz-reveal.test.ts do.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** The source with its comments removed, so a rule named in prose does not pass for one in code. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Every TypeScript source the app ships, relative to the repo root. */
function sources(): string[] {
  return ["app", "components", "lib"]
    .flatMap((dir) => walk(join(process.cwd(), dir)))
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => f.slice(process.cwd().length + 1));
}

const HOME = "app/page.tsx";
const QUIZ_PAGE = "app/quiz/page.tsx";
const QUIZ_FORM = "app/quiz/quiz-create.tsx";
const GAME = "app/game/page.tsx";

describe("/quiz is a page of its own", () => {
  const page = read(QUIZ_PAGE);
  const body = code(page);

  it("exists, declares its own metadata, and is canonical on itself", () => {
    // The root layout's canonical is the home page, and a nested segment
    // inherits every top-level key it does not set. Without `alternates`
    // here, /quiz would tell Google it is `/`.
    expect(existsSync(join(process.cwd(), QUIZ_PAGE))).toBe(true);
    expect(body).toContain("export const metadata");
    expect(body).toMatch(/alternates:\s*\{\s*canonical:\s*"\/quiz"\s*\}/);
    expect(body).toMatch(/openGraph:\s*\{[\s\S]*?\burl:\s*"\/quiz"/);
  });

  it("is indexable: no noindex on the page and no segment layout adding one", () => {
    // /q/<code> is noindex because a quiz link is ephemeral. /quiz is the
    // durable page describing the feature and the one URL a search can
    // land on; it must not inherit the quiz link's rule by sitting one
    // directory over.
    expect(body).not.toMatch(/noindex|index:\s*false/);
    for (const file of walk(join(process.cwd(), "app/quiz"))) {
      expect(code(readFileSync(file, "utf8")), file).not.toMatch(/noindex|index:\s*false/);
    }
    expect(body).not.toMatch(/export\s+const\s+runtime\s*=\s*["']edge["']/);
  });

  it("renders the shared chrome, the outage notice, and the footer", () => {
    // `SetupStyles` is where `.card`, `.start-btn`, `.pill` and the rest are
    // declared once; `QuizPanel` and the form come out unstyled without it.
    // `ServiceNotice` because creating a quiz is a Spotify-bearing step and
    // a host has to be told when the quota is gone. `SiteFooter` is pinned
    // beside the other landing pages in tests/site-policy.test.ts too.
    for (const element of ["<SetupStyles />", "<SetupBackdrop />", "<ServiceNotice />", "<QuizAboutAndFooter />", "<QuizCreate />"]) {
      expect(body, element).toContain(element);
    }
    // The footer is drawn by the explainer, in the device's language, so the
    // page is one language top to bottom (lib/quiz-about.ts).
    expect(code(read("app/quiz/quiz-about.tsx"))).toContain("<SiteFooter locale={locale} />");
  });
});

describe("the quiz form on /quiz", () => {
  const body = code(read(QUIZ_FORM));

  it("never counts a quiz as a hosted game", () => {
    // CLAUDE.md: the quiz never calls `recordHostedStart`. On `/` that was
    // a local function; here it is the two things it did — the device's
    // game counter and the pulse beacon — that must stay out. A quiz that
    // bumped the count would inflate the one number the loop is judged on
    // and show the install banner to someone who has never hosted.
    for (const forbidden of ["recordHostedStart", "bumpHostGameCount", "reportGameStart", "game_started", "@/lib/loop-client"]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });

  it("keeps the loop's attribution: reads ?ref off the URL and remembers it", () => {
    // lib/loop-redirect.ts now sends `/r/quiz_result` here instead of to
    // `/`. If this page did not store the ref the way `/` does, the warm
    // arm would land, be counted as a click, and never be credited with the
    // game it leads to weeks later.
    expect(body).toMatch(/new URLSearchParams\(window\.location\.search\)\.get\("ref"\)/);
    expect(body).toMatch(/if \(ref\) rememberLoopRef\(ref\);/);
  });

  it("talks only to /api/quiz, and records what it makes on this device", () => {
    const calls = body.match(/fetch\([^,)]*/g) ?? [];
    expect(calls, "quiz-create.tsx no longer calls fetch at all").toHaveLength(1);
    for (const call of calls) {
      expect(call).toMatch(/^fetch\("\/api\/quiz"/);
    }
    expect(body).toMatch(/trackEvent\("quiz_created"/);
    // The token is the only way to the board; the last quiz is the way
    // back to it from this page.
    expect(body).toMatch(/rememberQuizToken\(created\.code, created\.hostToken\)/);
    expect(body).toMatch(/rememberLastQuiz\(/);
  });

  it("gives a remembered quiz its panel back, not a line of text", () => {
    // A reload used to swap the panel for one grey sentence linking to the
    // board: the QR and both buttons gone, for a quiz that three times in
    // four had not been sent yet. The panel is drawn from whichever source
    // has a quiz, and the way to the board is the panel's own link.
    expect(body).toMatch(/const shown: PanelQuiz \| null = createdQuiz \?\? lastQuiz;/);
    expect(body).toMatch(/\{shown && \(/);
    expect(body.match(/<QuizPanel\b/g) ?? []).toHaveLength(1);
    for (const prop of ["code", "ownerName", "playlistName", "questionCount", "expiresAt"]) {
      expect(body, prop).toContain(`${prop}={shown.${prop}}`);
    }
    // What it remembers has to include the count, or the panel that comes
    // back has a caption with no number to put in it.
    expect(body).toMatch(/const remembered: LastQuiz = \{[\s\S]*?questionCount: created\.questionCount,[\s\S]*?\};/);
    // The grey line is gone, and nothing on the form links to the board itself.
    expect(body).not.toMatch(/\/board/);
    expect(body).not.toMatch(/lastQuiz\.playlistName/);
    // And the button says "a new link" over either kind of panel: pressing
    // it makes a second code, it does not change the one on screen.
    expect(body).toMatch(/\) : shown \? \(\s*copy\.createAgainButton\s*\) : \(\s*copy\.createButton\s*\)/);
  });

  it("is written in the visitor's language: every sentence comes from QUIZ_COPY", () => {
    // The form was hardcoded English around a panel that was not. Every
    // string a visitor reads is a `copy.*` lookup now; what is left as a
    // literal is an address or a number, neither of which is a sentence.
    expect(body).toMatch(/const copy = QUIZ_COPY\[locale\];/);
    for (const literal of [
      "Taste Quiz",
      "A link your friends open",
      "Spotify Playlist",
      "Editorial playlists",
      "Your Name",
      "Whose taste is this",
      "Goes in the title",
      "Custom number of questions",
      "Your last quiz",
      "Loading playlist",
      "Create quiz link",
      "Create a new link",
      "Back to the party game",
      "Making your link",
      "Your quiz link",
    ]) {
      expect(body, `quiz-create.tsx still says "${literal}"`).not.toContain(literal);
    }
    // No text node and no quoted attribute holds a word: between a tag's
    // `>` and the next `<` there is whitespace, an expression, or the one
    // warning glyph. Read from each `return (` on, so a generic's angle
    // brackets in the code above are not mistaken for a tag's.
    const rendered = body.split(/\n\s*return \(\n/).slice(1);
    expect(rendered.length, "the form and its two stand-ins").toBe(3);
    for (const jsx of rendered) {
      const markup = jsx.slice(0, jsx.indexOf("\n  );") + 1 || undefined);
      const prose = [...markup.matchAll(/>([^<>{}]*[A-Za-z]{3,}[^<>{}]*)</g)].map((m) => m[1].trim());
      expect(prose).toEqual([]);
    }
    expect(body).toMatch(/\{copy\.createMakingLink\}/);
    expect(body).toMatch(/\{QUIZ_COPY\[locale\]\.createLinkFallback\}/);
    for (const attribute of ["placeholder", "aria-label", "alt", "title"]) {
      const quoted = [...body.matchAll(new RegExp(`${attribute}="([^"]*)"`, "g"))].map((m) => m[1]);
      // The playlist box's placeholder is an address, not a sentence.
      expect(quoted.filter((v) => !v.startsWith("https://")), attribute).toEqual([]);
    }
  });

  it("says who answers the questions, under the picker, and leaves the picker alone", () => {
    // Forty of seventy-seven owners picked something longer than the
    // default and the long ones were finished by nobody. The line is the
    // whole change: the presets, the default and the bounds are being
    // measured until 2026-10-06 and must read exactly as they did.
    expect(body).toMatch(/\{copy\.createLengthNote\}/);
    expect(body.indexOf("copy.createLengthNote")).toBeGreaterThan(body.indexOf("commitCustom(s, QUIZ_COUNT_CONTROL)"));
    expect(body).toMatch(/useState\(DEFAULT_QUIZ_COUNT_STATE\)/);
    expect(body).toMatch(/\{QUIZ_QUESTION_COUNTS\.map\(\(c\) => \(/);
    expect(body).toMatch(/min=\{QUIZ_MIN_QUESTIONS\}\s*max=\{QUIZ_MAX_QUESTIONS\}/);
    const types = read("types/quiz.ts");
    expect(types).toContain("export const QUIZ_QUESTION_COUNTS = [10, 20, 30, 50] as const;");
    expect(types).toContain("export const QUIZ_DEFAULT_QUESTION_COUNT = 10;");
    expect(types).toContain("export const QUIZ_MIN_QUESTIONS = 10;");
    expect(types).toContain("export const QUIZ_MAX_QUESTIONS = 50;");
  });

  it("reads the playlist link through the one classifier, and never gates Create on it", () => {
    // The form used to carry its own `includes("spotify.com/playlist")`,
    // which disagreed with the server about `/intl-xx/` and short links.
    // It must not block either: a wrong link sent here is what
    // `playlist_invalid:*` counts.
    const source = read(QUIZ_FORM);
    expect(source).not.toMatch(/includes\(\s*["'`][^"'`]*(spotify|37i9)/);
    expect(source).toMatch(/isSubmittablePlaylistLink\(playlistUrl\)/);
    expect(source).toMatch(/isEditorialPlaylistLink\(playlistUrl\)/);
  });

  it("counts questions with the quiz's own bounds, not the party's", () => {
    // `typeCustom`/`commitCustom` default to the song count's 1…MAX. Left
    // at the default, a half-typed "4" on the way to "45" would commit and
    // the route would refuse a four-question quiz.
    expect(body).toMatch(/typeCustom\(s, raw, QUIZ_COUNT_CONTROL\)/);
    expect(body).toMatch(/commitCustom\(s, QUIZ_COUNT_CONTROL\)/);
    expect(body).toMatch(/quizCountOf\(count\)/);
  });

  it("remembers a determinate refusal, keyed on what was submitted", () => {
    // Same reason as `/`: a refused playlist returns from the negative
    // cache faster than the button re-enables, and every extra tap was a
    // billed invocation. Keyed on URL and count so changing either asks
    // again without an explicit reset.
    expect(body).toMatch(/const submissionKey = `quiz:\$\{playlistUrl\}:\$\{questionCount\}`/);
    expect(body).toMatch(/shouldRememberRejection\(e\)/);
    expect(body).toMatch(/role="alert"/);
  });

  it("offers the way back to the party game", () => {
    expect(body).toMatch(/<Link href="\/"/);
  });
});

describe("/ after the quiz left it", () => {
  const body = code(read(HOME));

  it("carries no quiz form: nothing posts to /api/quiz and no panel renders", () => {
    expect(body).not.toContain("/api/quiz");
    expect(body).not.toContain("QuizPanel");
    expect(body).not.toContain("quiz_created");
  });

  it("redirects the two old spellings to /quiz with a replace, so Back does not bounce", () => {
    // `/?mode=quiz` from cached content pages and `/?ref=quiz_result` from
    // links already in group chats. `replace`, not `href =`: the arrival
    // must not sit in history as a page that redirects the moment it is
    // returned to.
    expect(body).toMatch(
      /if \(requestedSetupMode\(query\) === "quiz"\) \{\s*window\.location\.replace\(quizArrivalHref\(query\)\);\s*return;\s*\}/
    );
    expect(body).not.toMatch(/window\.location\.href\s*=/);
  });

  it("reads the mixed minimum from lib/start-status, never a local copy", () => {
    // The page declared `MIXED_MIN_CONTRIBUTORS = 2` itself until the Start
    // ladder moved to lib/; a reintroduced local copy would drift silently.
    expect(body).toMatch(/import \{[^}]*\bMIXED_MIN_CONTRIBUTORS\b[^}]*\} from "@\/lib\/start-status"/);
    expect(body).not.toMatch(/const MIXED_MIN_CONTRIBUTORS\b/);
    expect(body).toMatch(/mixedContributions\.length < MIXED_MIN_CONTRIBUTORS/);
  });

  it("links to the quiz's own page through the one constant, like every other entry point", () => {
    for (const page of [HOME, "app/about/page.tsx", "app/zh/page.tsx", "app/q/[code]/quiz-client.tsx"]) {
      const source = code(read(page));
      expect(source, page).toMatch(/import \{[^}]*\bQUIZ_SETUP_HREF\b[^}]*\} from "@\/lib\/setup-arrival"/);
      expect(source, page).toMatch(/href=\{QUIZ_SETUP_HREF\}/);
    }
    expect(QUIZ_SETUP_HREF).toBe("/quiz");
  });

  it("has no href left that asks for the quiz by ?mode=quiz", () => {
    // The redirect honours the old spelling; nothing of ours may still
    // produce it, or the hop is paid on every visit from that page.
    for (const file of sources()) {
      expect(code(read(file)), file).not.toMatch(/mode=quiz/);
    }
  });

  it("still shows the install pitch, and only to a device that has hosted before", () => {
    expect(body).toContain("<InstallBanner />");
    const banner = code(read("components/install-banner.tsx"));
    // Hidden by default so the server never renders it; shown after mount
    // to a repeat host; gone for good once installed.
    expect(banner).toMatch(/const \[visible, setVisible\] = useState\(false\);/);
    expect(banner).toMatch(/if \(isStandalone\(\) \|\| getHostGameCount\(\) < 1\) return;/);
    expect(banner).toMatch(/if \(!visible\) return null;/);
  });

  it("draws the class names from the shared stylesheet, declared once", () => {
    // The 400-line <style> block lived in app/page.tsx and RoomPanel,
    // QuizPanel and MixedPlaylistCollector quietly depended on it. A page
    // that renders one of those panels renders <SetupStyles />, and neither
    // page declares the classes again.
    const chrome = read("components/setup-chrome.tsx");
    for (const cls of [".card", ".start-btn", ".pill", ".url-input", ".player-input", ".text-link", ".mode-links", ".start-status", ".hero-title"]) {
      expect(chrome, cls).toMatch(new RegExp(`^\\s*${cls.replace(".", "\\.")} \\{`, "m"));
      for (const page of [HOME, QUIZ_PAGE, QUIZ_FORM]) {
        expect(read(page), `${page} redeclares ${cls}`).not.toMatch(new RegExp(`^\\s*${cls.replace(".", "\\.")} \\{`, "m"));
      }
    }
    for (const page of [HOME, QUIZ_PAGE]) {
      expect(code(read(page)), page).toContain("<SetupStyles />");
    }
  });
});

describe("the FAQ on / is one list, rendered twice", () => {
  // Google penalises FAQPage schema that does not match the visible answers,
  // and nothing on screen says when it has drifted: the page renders, the
  // JSON-LD validates, and the two quietly say different things. One array,
  // mapped in both places, is what makes drift impossible — so this pins that
  // both renders read `FAQS` and nothing else, and that the array itself
  // stays the size and shape a rich result is granted for.
  const raw = read(HOME);
  const body = code(raw);

  /** The array literal as written, entry by entry, without executing the page. */
  function faqs(): { q: string; a: string }[] {
    const declaration = "const FAQS: { q: string; a: string }[] = [";
    const start = raw.indexOf(declaration);
    expect(start, "FAQS is declared with q and a").toBeGreaterThan(-1);
    const end = raw.indexOf("\n];", start);
    // From the opening bracket, so the annotation's own `q:` is not an entry.
    const block = raw.slice(start + declaration.length, end);
    const entries = [...block.matchAll(/\{\s*q:\s*"((?:[^"\\]|\\.)*)",\s*a:\s*"((?:[^"\\]|\\.)*)",?\s*\}/g)];
    // Every `q:` in the block has to have been read as an entry, or a
    // malformed one would be skipped rather than counted.
    expect(entries, "every entry parsed").toHaveLength((block.match(/\bq:/g) ?? []).length);
    return entries.map(([, q, a]) => ({ q: JSON.parse(`"${q}"`), a: JSON.parse(`"${a}"`) }));
  }

  it("emits FAQPage JSON-LD from FAQS, through JSON.stringify", () => {
    // Hand-written JSON in a template string is how a stray quote in an
    // answer breaks the schema silently; `JSON.stringify` escapes for us.
    expect(body).toMatch(
      /dangerouslySetInnerHTML=\{\{\s*__html:\s*JSON\.stringify\(\{[\s\S]*?"@type":\s*"FAQPage",\s*mainEntity:\s*FAQS\.map\(\(faq\)\s*=>\s*\(\{\s*"@type":\s*"Question",\s*name:\s*faq\.q,\s*acceptedAnswer:\s*\{\s*"@type":\s*"Answer",\s*text:\s*faq\.a\s*\},?\s*\}\)\)/
    );
  });

  it("renders the visible list from the same FAQS, question then answer", () => {
    expect(body).toMatch(
      /FAQS\.map\(\(faq\)\s*=>\s*\(\s*<div key=\{faq\.q\}>\s*<h3 className="faq-q">\{faq\.q\}<\/h3>\s*<p className="faq-a">\{faq\.a\}<\/p>\s*<\/div>\s*\)\)/
    );
  });

  it("reads FAQS in exactly those two places, and retypes no question anywhere", () => {
    expect(body.match(/FAQS\.map\(/g) ?? []).toHaveLength(2);
    expect(body.match(/\bFAQS\b/g) ?? [], "declaration plus two reads").toHaveLength(3);
    // No third FAQ hand-written beside the two renders.
    expect(body.match(/"@type":\s*"Question"/g) ?? []).toHaveLength(1);
    expect(body.match(/className="faq-q"/g) ?? []).toHaveLength(1);
    for (const { q } of faqs()) {
      expect(raw.split(`"${q}"`), `"${q}" appears once`).toHaveLength(2);
    }
  });

  it("has four questions, each with a question and an answer of at most two sentences", () => {
    // Four is what the rich result shows without folding; an answer longer
    // than two sentences is an article, and belongs in /guides. The count is
    // conservative — a terminator is `. `, `? ` or `! ` followed by a capital,
    // so "Discover Weekly and the like) can't" and "3 points" do not split.
    const list = faqs();
    expect(list).toHaveLength(4);
    for (const { q, a } of list) {
      expect(q.trim().length, q).toBeGreaterThan(0);
      expect(q.trim().endsWith("?"), `${q} asks`).toBe(true);
      expect(a.trim().length, a).toBeGreaterThan(0);
      const sentences = 1 + (a.match(/[.?!] (?=[A-Z])/g) ?? []).length;
      expect(sentences, `${q} → ${a}`).toBeLessThanOrEqual(2);
    }
  });
});

describe("the loop says one thing", () => {
  it("has its carriers read the three sentences from lib/loop-links.ts", () => {
    const cta = code(read("components/loop-cta.tsx"));
    expect(cta).toMatch(/children = LOOP_CTA_LABEL/);
    expect(cta).toMatch(/LOOP_FOOTER_LABEL\.split\("GuessSong"\)/);
    const qr = code(read("components/loop-qr.tsx"));
    expect(qr).toMatch(/\{LOOP_QR_CAPTION\}/);
    // The result card printed the caption beside its QR until the `share`
    // arm read 0 of 94 and the code came off (1.15.0). What it prints now is
    // the bare address, and nothing scan-shaped: a "Scan to …" line with no
    // code under it would be the one place the loop's copy lied.
    const card = code(read("lib/result-image.ts"));
    expect(card).not.toMatch(/LOOP_QR_CAPTION/);
    expect(card).toMatch(/fillText\("guessong\.app"/);
    expect(card).not.toMatch(/drawImage/);
  });

  it("lets the party pages inherit the button's label, and only the quiz name its own", () => {
    // The quiz result is read in the taker's language, so it hands the
    // button `copy.makeYourOwn`; every other carrier says LOOP_CTA_LABEL by
    // saying nothing.
    for (const page of ["app/buzz/[code]/page.tsx", "app/j/[code]/page.tsx"]) {
      const source = code(read(page));
      expect(source, page).toContain("<LoopCtaButton");
      expect(source, page).not.toContain("</LoopCtaButton>");
    }
    const client = code(read("app/q/[code]/quiz-client.tsx"));
    expect(client).toMatch(/<LoopCtaButton surface="quiz_result">\{copy\.makeYourOwn\}<\/LoopCtaButton>/);
    // And the same phrase in place of Retry when the quiz is gone.
    expect(client.match(/copy\.makeYourOwn/g) ?? []).toHaveLength(2);
  });

  it("carries none of the retired phrasings anywhere in code", () => {
    // Seven spellings of one sentence were the reason for the constants.
    // Comments stripped, and the two files allowed to hold history —
    // lib/loop-links.ts declares them, lib/changelog.ts quotes them.
    const retired = [
      "Host the next one",
      "Scan to host your own party",
      "Scan to play your own",
      "Played with GuessSong",
      "Make one for your friends",
      "Make one of your own",
    ];
    for (const file of sources()) {
      if (file === "lib/loop-links.ts" || file === "lib/changelog.ts") continue;
      const body = code(read(file));
      for (const phrase of retired) {
        expect(body, `${file} still says "${phrase}"`).not.toContain(phrase);
      }
      // The literal sentences appear nowhere but their declaration either.
      // Bare phrase, not the quoted form: JSX text and template literals
      // retype it just as well as a string literal does.
      for (const label of [LOOP_CTA_LABEL, LOOP_FOOTER_LABEL, LOOP_QR_CAPTION]) {
        expect(body, `${file} retypes "${label}" instead of importing it`).not.toContain(label);
      }
    }
  });
});

describe("the quiz panel and the board print the address only when the buttons cannot move it", () => {
  it("puts the URL under the failure line, and nowhere else", () => {
    // The copy now reads "copy this link by hand:" with the link under it;
    // it used to say "the link above". Both halves have to move together
    // or the sentence points at nothing.
    for (const [file, key] of [
      ["components/quiz-panel.tsx", "copy.panelShareFailed"],
      ["app/q/[code]/board/page.tsx", "copy.boardShareFailed"],
    ] as const) {
      // Raw source, not `code()`: the print strips the scheme with a regex
      // literal whose `\/\/` the comment stripper would read as a comment.
      const body = read(file);
      const prints = body.match(/url\.replace\(/g) ?? [];
      expect(prints, `${file} prints the URL ${prints.length} times`).toHaveLength(1);
      expect(body.indexOf(key), `${file} lost ${key}`).toBeGreaterThan(-1);
      expect(body.indexOf(key), `${file} prints the URL before the line that points at it`).toBeLessThan(body.indexOf("url.replace("));
    }
    const panel = code(read("components/quiz-panel.tsx"));
    expect(panel).toMatch(/copy\.panelResultsUntil/);
    expect(panel).not.toMatch(/panelDeviceOnly|panelExpires\b/);
  });

  it("puts the sentence and the link on the owner's clipboard, from all four buttons", () => {
    // The share sheet takes `text` and `url` apart; a clipboard has one
    // field, and the owner's used to get the bare address. The taker's share
    // has always copied both.
    for (const file of ["components/quiz-panel.tsx", "app/q/[code]/board/page.tsx"]) {
      const body = code(read(file));
      const quiz = file.startsWith("components") ? "quiz" : "board";
      // The fallback: `shareLink`'s second argument is what it writes when
      // there is no share sheet.
      expect(body, file).toMatch(
        new RegExp(`await shareLink\\(\\s*\\{[^}]*\\},\\s*ownerClipboardText\\(copy, ${quiz}, url\\)\\s*\\)`)
      );
      expect(body, file).toMatch(new RegExp(`await copyLink\\(ownerClipboardText\\(copy, ${quiz}, url\\)\\)`));
      expect(body, file).not.toMatch(/copyLink\(url\)/);
    }
  });

  it("offers the owner their own quiz by its plain address, with nothing in it that marks them", () => {
    // The preview is a link to the URL the friends get. What makes it a
    // preview is this device's token, sent in a header by the page it lands
    // on — a query string here would be pasted into the group chat with the
    // link and make every friend the owner.
    const panel = code(read("components/quiz-panel.tsx"));
    expect(panel).toMatch(/<a href=\{`\/q\/\$\{code\.toUpperCase\(\)\}`\} className="link-btn">\s*\{copy\.panelPreviewLink\}/);
    expect(panel).toMatch(/<a href=\{`\/q\/\$\{code\.toUpperCase\(\)\}\/board`\} className="link-btn">\s*\{copy\.panelBoardLink\}/);
    for (const file of ["components/quiz-panel.tsx", "app/q/[code]/quiz-client.tsx", "lib/quiz-session.ts"]) {
      const body = code(read(file));
      expect(body, file).not.toMatch(/[?&](owner|token|host|preview)=/i);
    }
    // The token is read in one place and leaves in a header.
    const client = code(read("app/q/[code]/quiz-client.tsx"));
    expect(client).not.toMatch(/recallQuizToken|x-host-token|hostToken/);
    expect(client.match(/quizOwnerHeaders\(code\)/g) ?? []).toHaveLength(3);
    expect(client).not.toMatch(/URLSearchParams|location\.search/);
  });
});

describe("the taker page, for the person who made the quiz", () => {
  const body = code(read("app/q/[code]/quiz-client.tsx"));

  it("believes the server about who is the owner, never the token it holds", () => {
    // "Your answers are not saved" is a statement about what the server did
    // with the sheet. The page reads `view.owner` on the way in and
    // `result.preview` on the way out, both set only after the token was
    // checked against the quiz's own.
    expect(body).toMatch(/const owner = view\.owner === true;/);
    expect(body).toMatch(/const canStart = owner \|\| name\.trim\(\)\.length > 0;/);
    expect(body).toMatch(/\{owner \? copy\.previewStart : copy\.startButton\}/);
    expect(body).toMatch(/\{copy\.previewIntro\}/);
    expect(body).toMatch(/\{result\.preview \? \(/);
    expect(body).toMatch(/\{copy\.previewResultNote\}/);
    // A preview is not "the board is full".
    expect(body).toMatch(/\{!result\.recorded && !result\.preview && <p className="q-muted">\{copy\.boardFull\}<\/p>\}/);
  });

  it("sends the token with the view, the check and the sheet, and with nothing else", () => {
    expect(body).toMatch(/cache: "no-store",\s*headers: quizOwnerHeaders\(code\),/);
    expect(body.match(/headers: \{ "Content-Type": "application\/json", \.\.\.quizOwnerHeaders\(code\) \}/g) ?? []).toHaveLength(2);
    // The hint is upstream cost, counted whoever asked.
    const hint = body.match(/const res = await fetch\(\s*`\/api\/quiz\/\$\{encodeURIComponent\(code\)\}\/hint[\s\S]*?\);/)?.[0] ?? "";
    expect(hint).not.toBe("");
    expect(hint).not.toContain("quizOwnerHeaders");
  });

  it("asks for a re-read, not an open, once the page has had its open", () => {
    // Refresh on the result screen always; the loader only after a load has
    // succeeded, so Retry after a refusal — which the server counted nothing
    // for — is still this page's one open.
    expect(body).toMatch(/const fresh = await fetchView\(code, \{ refetch: true \}\);/);
    expect(body).toMatch(/const quiz = await fetchView\(code, \{ refetch: openedRef\.current \}\);/);
    expect(body).toMatch(/const query = options\.refetch \? `\?\$\{QUIZ_REFETCH_PARAM\}=1` : "";/);
    expect(body.match(/fetchView\(/g) ?? []).toHaveLength(3);
    // Set only on success, after the fetch it guards.
    expect(body.indexOf("openedRef.current = true;")).toBeGreaterThan(body.indexOf("refetch: openedRef.current"));
  });

  it("keeps no finished row for a preview, and no loop surface on its result", () => {
    // The stored row is what "See my result again" re-POSTs; a preview wrote
    // none, so every replay would be graded afresh and counted again. And
    // `quiz_result` is a friend who has just finished — its impression is the
    // denominator of the loop's one warm arm.
    expect(body).toMatch(/if \(!graded\.preview\) \{\s*const stored: QuizSubmission = \{/);
    const preview = body.match(/\{result\.preview \? \(([\s\S]*?)\) : \(/)?.[1] ?? "";
    expect(preview).not.toBe("");
    expect(preview).not.toContain("LoopCtaButton");
    expect(preview).not.toContain("handleShare");
    expect(preview).toMatch(/href=\{`\/q\/\$\{view\.code\}\/board`\}/);
    expect(body).toMatch(/const mine = owner \? null : finished\[0\] \?\? null;/);
    // And a run in progress is marked, so a reload resumes it for the owner
    // and for nobody else.
    expect(body).toMatch(/\.\.\.\(view\.owner \? \{ preview: true as const \} : \{\}\),/);
  });

  it("tells GA4 who was holding the phone, as a bucket", () => {
    expect(body).toMatch(/viewer: quiz\.owner \? "owner" : "taker",/);
    expect(body).toMatch(/viewer: graded\.preview \? "owner" : "taker",/);
  });
});

describe("the game page's round controls", () => {
  const body = code(read(GAME));

  it("tells the room nobody scored from Next Track, under exactly the conditions the button had", () => {
    // The song row's "No one" button sent `host:reveal` so the phones heard
    // the round was over. It is gone; Next Track is how a host says that
    // now, and it has to send the same message first — the answer is up,
    // nothing awarded, no buzz waiting — or a buzzer room's phones sit on
    // a live queue until the next round opens. `next()` alone resets the
    // room without a `round:resolved`, which is what the analytics count.
    // The three gates are the rule in lib/round-outcome.ts (tested there);
    // the page keeps only the null check on the room and the ordering.
    expect(body).toMatch(
      /const room = buzzerControlsRef\.current;\s*if \(room && announcesNoScore\(\{ phase, pointsAwarded, buzzesPending: room\.buzzes\.length \}\)\) \{\s*room\.reveal\(\);\s*\}\s*retireRound\(\);\s*room\?\.next\(\);/
    );
  });

  it("has no 'No one' buttons left — Next Track is what nobody-got-it looks like", () => {
    expect(body).not.toMatch(/No one\s*<\/button>/);
    // And no "No one scored" verdict either: a point is only ever recorded
    // together with the name it went to, so the line has nothing to say.
    expect(body).not.toContain("No one scored");
  });

  it("keeps one exit in the header: End Game, which goes through the scores", () => {
    // A second button that dropped the host on "/" with no confirmation
    // lost whole games to a mis-tap. The way home is Play Again, on the
    // scores screen, and the no-payload bounce on mount.
    const header = body.slice(body.indexOf("<header"), body.indexOf("</header>"));
    expect(header.match(/<button/g) ?? []).toHaveLength(1);
    expect(header).toMatch(/onClick=\{endGame\}/);
    expect(header).not.toMatch(/router\.push/);
    expect(header).not.toMatch(/Quit/);
  });

  it("shares Reveal and Skip between the two waiting-phase branches", () => {
    // "Finding audio…" and "no audio" used to carry their own copies of
    // the same two buttons; one helper keeps them from drifting.
    expect(body.match(/skipControls\(\)/g) ?? []).toHaveLength(3);
    expect(body).toMatch(/function skipControls\(\)[\s\S]*?onClick=\{reveal\}[\s\S]*?onClick=\{nextTrack\}/);
  });
});
