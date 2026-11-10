// Translations without React, usable on the server and in the browser.
//
// The English text is the key: `translate("ru", "Add to list")`. A missing
// translation falls back to the English text, so nothing ever shows empty.
// `{name}` placeholders are filled from `vars`. An entry can be a set of plural
// forms picked by `vars.n` (Intl.PluralRules of the language).
import { ar } from "./dict/ar";
import { en } from "./dict/en";
import { he } from "./dict/he";
import { ru } from "./dict/ru";

export const LANGS = [
  { code: "en", label: "English", short: "EN" },
  { code: "ru", label: "Русский", short: "RU" },
  { code: "he", label: "עברית", short: "HE" },
  { code: "ar", label: "العربية", short: "AR" },
] as const;

export type Lang = (typeof LANGS)[number]["code"];
export type PluralEntry = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
export type Dict = Record<string, string | PluralEntry>;
export type Vars = Record<string, string | number>;

export const DEFAULT_LANG: Lang = "en";
export const LANG_COOKIE = "lang";

const DICTS: Record<Lang, Dict> = { en, ru, he, ar };

export function isLang(value: unknown): value is Lang {
  return LANGS.some((lang) => lang.code === value);
}

export function isRtl(lang: Lang): boolean {
  return lang === "he" || lang === "ar";
}

// Locale for dates and numbers. Arabic keeps Latin digits, like the product
// numbers on the labels.
export function localeOf(lang: Lang): string {
  return lang === "ar" ? "ar-u-nu-latn" : lang;
}

// First supported language from an Accept-Language header, else English.
export function langFromHeader(header: string | null | undefined): Lang {
  for (const part of (header ?? "").split(",")) {
    const code = part.trim().slice(0, 2).toLowerCase();
    if (code === "iw") return "he";
    if (isLang(code)) return code;
  }
  return DEFAULT_LANG;
}

const pluralRules = new Map<Lang, Intl.PluralRules>();

function pluralOf(lang: Lang, n: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(lang);
  if (!rules) {
    rules = new Intl.PluralRules(lang);
    pluralRules.set(lang, rules);
  }
  return rules.select(n);
}

function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

// The raw text for a key, before placeholders are filled.
export function lookup(lang: Lang, key: string, vars?: Vars): string {
  const entry = DICTS[lang][key] ?? (lang === "en" ? undefined : en[key]) ?? key;
  if (typeof entry === "string") return entry;
  const n = Number(vars?.n ?? 0);
  return entry[pluralOf(lang, n)] ?? entry.other;
}

export function translate(lang: Lang, key: string, vars?: Vars): string {
  return fill(lookup(lang, key, vars), vars);
}

export type Translate = (key: string, vars?: Vars) => string;

export function translator(lang: Lang): Translate {
  return (key, vars) => translate(lang, key, vars);
}

// Marks a text for translation where it is defined (tables, server errors) and
// translated later with t(). Returns the text unchanged.
export function msg<T extends string>(text: T): T {
  return text;
}
