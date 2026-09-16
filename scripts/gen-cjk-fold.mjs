#!/usr/bin/env node
/**
 * Regenerates lib/cjk-fold.ts — the Traditional → Simplified character table
 * the quiz keys titles through.
 *
 * opencc-js is deliberately not a dependency: the table is a fact about
 * Unicode that does not change between releases, and the create route is the
 * only consumer. Run this from a scratch directory that has it installed:
 *
 *   mkdir /tmp/cjk && cd /tmp/cjk && npm init -y && npm i opencc-js@1.4.2
 *   node <repo>/scripts/gen-cjk-fold.mjs /tmp/cjk/node_modules/opencc-js > <repo>/lib/cjk-fold.ts
 *
 * One character in, one character out, from the CJK Unified Ideographs block
 * only. OpenCC's t, tw and hk tables are all consulted so a Taiwan- or Hong
 * Kong-only variant (裡, 著, 衛) still lands on the one simplified form; the
 * first table that changes the character wins, and on the three characters
 * where they disagree that is `t`.
 *
 * **The table is closed under itself, and the generator has to make it so.**
 * OpenCC's character tables are not: 麼 → 么 and, because 么 is also listed
 * as a Traditional variant of 幺, 么 → 幺 — so a raw dump folded 怎麼了 to
 * 怎么了 and 怎么了 to 怎幺了, two keys for the one song, and the pool's own
 * 怎麼了 was offered as the decoy for a Simplified playlist's 怎么了 (the
 * bug this table exists to close, reopened for the most common word in the
 * language). Every target is therefore chased to its fixpoint before it is
 * written (麼 → 幺, 么 → 幺; 薴 → 苎, 苧 → 苎), which is loose in the safe
 * direction: keys are never shown, and over-folding two words onto one costs
 * a decoy where under-folding one word into two costs a point.
 * tests/cjk-fold.test.ts pins closure over the whole table.
 */

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";

const modulePath = process.argv[2];
if (!modulePath) {
  console.error("usage: gen-cjk-fold.mjs <path/to/node_modules/opencc-js>");
  process.exit(1);
}
// The package's ESM entry; the bare directory is not importable from a file
// outside its node_modules.
const OpenCC = await import(pathToFileURL(resolve(modulePath, "dist/esm/full.js")).href);
const { version } = JSON.parse(await readFile(resolve(modulePath, "package.json"), "utf8"));
const converters = ["t", "tw", "hk"].map((from) => OpenCC.Converter({ from, to: "cn" }));

const raw = new Map();
for (let cp = 0x4e00; cp <= 0x9fff; cp += 1) {
  const ch = String.fromCodePoint(cp);
  const out = converters.map((c) => c(ch)).find((o) => o !== ch);
  if (out === undefined || [...out].length !== 1) continue;
  raw.set(ch, out);
}

// Chase every target to a character the table does not fold again. A cycle
// (none today) would spin here, so it is bounded and reported rather than
// silently broken one way or the other.
const from = [];
const to = [];
for (const [ch, first] of raw) {
  let out = first;
  const seen = new Set([ch]);
  while (raw.has(out)) {
    if (seen.has(out)) {
      console.error(`cycle through ${[...seen].join(" → ")} → ${out}; break it by hand`);
      process.exit(1);
    }
    seen.add(out);
    out = raw.get(out);
  }
  from.push(ch);
  to.push(out);
}

const source = `/**
 * Han characters folded to one script, for keys — never for display.
 *
 * Spotify stores a mainland act's catalogue in Simplified Chinese — Joker
 * Xue's 演员, Mao Buyi's 像我这样的人, Zhou Shen's 化身孤岛的鲸, measured against
 * the search API on 2026-09-15 — and lib/quiz-decoys.ts is written in
 * Traditional, so the quiz's "is this decoy already in the playlist" check
 * compared 演員 with 演员 and let the playlist's own song through as the
 * wrong answer. \`titleKey\` in lib/quiz.ts runs both sides through this.
 *
 * Traditional → Simplified and not the reverse, because that direction is
 * (nearly) a function: a traditional form has one simplified form, while the
 * reverse is one-to-many (后 is both 后 and 後, 发 both 發 and 髮). Folding two
 * characters onto one can only over-match, and over-matching excludes a decoy
 * that was fine — the cheap failure. "Nearly", because OpenCC also lists a few
 * simplified characters as variants of a third (么 → 幺), so the generator
 * chases every target to a fixpoint and the table is closed under itself.
 *
 * GENERATED — the whole file, functions included — by scripts/gen-cjk-fold.mjs
 * from opencc-js ${version} (t, tw and hk tables → cn), CJK Unified
 * Ideographs U+4E00–U+9FFF, ${from.length} pairs, every target chased to a
 * fixpoint so the table is closed under itself (麼 and 么 both → 幺).
 * Callers NFKC-normalise first (\`titleKey\` and \`foldText\` in lib/quiz.ts do),
 * which is what folds the compatibility ideographs; the table itself does not.
 * Do not edit by hand; change the generator and regenerate.
 */

const FROM =
  "${from.join("")}";
const TO =
  "${to.join("")}";

let table: Map<string, string> | null = null;

/** Every Traditional character in the table with its Simplified form. Built once, on first use. */
export function hanFoldTable(): ReadonlyMap<string, string> {
  if (!table) {
    table = new Map();
    const src = [...FROM];
    const dst = [...TO];
    for (let i = 0; i < src.length; i += 1) table.set(src[i], dst[i]);
  }
  return table;
}

const HAN = /[\\u4e00-\\u9fff]/;

/** \`text\` with every Traditional character replaced by its Simplified form. Everything else is untouched. */
export function foldHan(text: string): string {
  if (!HAN.test(text)) return text;
  const map = hanFoldTable();
  let out = "";
  for (const ch of text) out += map.get(ch) ?? ch;
  return out;
}
`;
process.stdout.write(source);
