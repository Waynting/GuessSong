import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TRANSLATE_GUARD_SCRIPT } from "@/lib/translate-guard";

/**
 * Issue #87: Google Translate on a Brazilian phone turned Start into the crash
 * screen. These pin both layers in lib/translate-guard.ts.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** What Google Translate does to a text node: swap it for <font><font>…</font></font>. */
function translate(text: Text): HTMLElement {
  const outer = document.createElement("font");
  const inner = document.createElement("font");
  inner.textContent = `[pt] ${text.nodeValue}`;
  outer.appendChild(inner);
  text.parentNode!.replaceChild(outer, text);
  return outer;
}

function translatedParent() {
  const parent = document.createElement("div");
  const text = document.createTextNode("Start");
  const sibling = document.createElement("span");
  parent.append(text, sibling);
  translate(text);
  return { parent, text, sibling };
}

describe("without the guard, a translated page throws exactly as reported", () => {
  it("removeChild of a translated text node is a NotFoundError", () => {
    const { parent, text } = translatedParent();
    expect(() => parent.removeChild(text)).toThrow(/not a child/i);
  });
});

describe("TRANSLATE_GUARD_SCRIPT", () => {
  beforeAll(() => {
    // eslint-disable-next-line no-new-func
    new Function(TRANSLATE_GUARD_SCRIPT)();
  });

  it("lets React remove a node Translate already detached", () => {
    const { parent, text } = translatedParent();
    expect(parent.removeChild(text)).toBe(text);
    expect(parent.textContent).toContain("[pt] Start");
  });

  it("removes a node someone moved from where it actually is", () => {
    const a = document.createElement("div");
    const b = document.createElement("div");
    const child = document.createElement("span");
    b.appendChild(child);
    expect(a.removeChild(child)).toBe(child);
    expect(child.parentNode).toBeNull();
  });

  it("inserts at the end when the reference node was swapped out", () => {
    const { parent, text } = translatedParent();
    const node = document.createElement("b");
    expect(parent.insertBefore(node, text)).toBe(node);
    expect(parent.lastChild).toBe(node);
  });

  it("leaves the ordinary paths alone", () => {
    const parent = document.createElement("div");
    const first = document.createElement("i");
    const second = document.createElement("i");
    parent.append(first, second);
    const node = document.createElement("b");
    parent.insertBefore(node, second);
    expect([...parent.childNodes]).toEqual([first, node, second]);
    parent.removeChild(node);
    expect([...parent.childNodes]).toEqual([first, second]);
    parent.insertBefore(node, null);
    expect(parent.lastChild).toBe(node);
  });

  it("installs once even if the script runs twice", () => {
    const before = Node.prototype.removeChild;
    new Function(TRANSLATE_GUARD_SCRIPT)();
    expect(Node.prototype.removeChild).toBe(before);
  });
});

describe("the layouts opt out of page translation", () => {
  for (const file of ["app/layout.tsx", "app/global-error.tsx"]) {
    it(`${file} carries translate="no" and the notranslate meta`, () => {
      const src = read(file);
      expect(src).toMatch(/<html lang="en" translate="no">/);
      expect(src).toContain('<meta name="google" content="notranslate" />');
    });
  }

  it("the root layout runs the guard inline in <head>, before hydration", () => {
    const src = read("app/layout.tsx");
    const head = src.slice(src.indexOf("<head>"), src.indexOf("</head>"));
    expect(head).toContain("__html: TRANSLATE_GUARD_SCRIPT");
  });
});
