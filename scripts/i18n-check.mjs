// Lists texts that need translation and checks the dictionaries.
//   node scripts/i18n-check.mjs          -> report missing / unused keys, exit 1 if missing
//   node scripts/i18n-check.mjs --keys   -> print every key as JSON
//   add --only <path prefix> to look only at texts from those files, e.g. --only app/settings
//
// A key is the first string argument of t(...), rich(...) or msg(...), and the
// `error: "..."` texts the API sends back (the screens show them through t()).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SOURCES = ["app", "lib"];
const LANGS = ["ru", "he", "ar"];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "node_modules" || name === "dict") continue;
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

function unescape(raw, quote) {
  return raw.replace(/\\(.)/g, (_, ch) => (ch === "n" ? "\n" : ch === quote || ch === "\\" ? ch : `\\${ch}`));
}

const CALL = /\b(?:t|rich|msg)\(\s*("|'|`)((?:\\.|(?!\1)[^\\])*)\1/g;
const ERROR = /\berror:\s*("|'|`)((?:\\.|(?!\1)[^\\])*)\1/g;

const onlyAt = process.argv.indexOf("--only");
const only = onlyAt > 0 ? process.argv[onlyAt + 1] : "";

const keys = new Map();
for (const file of SOURCES.flatMap((dir) => walk(join(ROOT, dir)))) {
  const text = readFileSync(file, "utf8");
  const rel = file.slice(ROOT.length);
  if (only && !rel.startsWith(only)) continue;
  const patterns = rel.startsWith("app/api/") || rel.startsWith("lib/") ? [CALL, ERROR] : [CALL];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const [, quote, raw] = match;
      if (quote === "`" && raw.includes("${")) continue;
      const key = unescape(raw, quote);
      if (!key.trim()) continue;
      if (!keys.has(key)) keys.set(key, new Set());
      keys.get(key).add(rel);
    }
  }
}

if (process.argv.includes("--keys")) {
  console.log(JSON.stringify([...keys.keys()].sort(), null, 2));
  process.exit(0);
}

// Dictionaries are TS object literals; read their keys without compiling.
// Entries must be written as `  "English text": ...` (two spaces, double quotes).
function dictKeys(lang) {
  const dir = join(ROOT, "lib/i18n/dict");
  const found = new Set();
  const KEY = /^\s{2}("(?:\\.|[^"\\])*")\s*:/gm;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(`.${lang}.ts`)) continue;
    const text = readFileSync(join(dir, name), "utf8");
    for (const match of text.matchAll(KEY)) found.add(JSON.parse(match[1]));
  }
  return found;
}

let missingTotal = 0;
for (const lang of LANGS) {
  const have = dictKeys(lang);
  const missing = [...keys.keys()].filter((key) => !have.has(key));
  const unused = only ? [] : [...have].filter((key) => !keys.has(key));
  missingTotal += missing.length;
  console.log(`${lang}: ${keys.size - missing.length}/${keys.size} translated, ${unused.length} unused`);
  for (const key of missing) console.log(`  missing: ${JSON.stringify(key)}  (${[...keys.get(key)].join(", ")})`);
  for (const key of unused) console.log(`  unused:  ${JSON.stringify(key)}`);
}
process.exit(missingTotal ? 1 : 0);
