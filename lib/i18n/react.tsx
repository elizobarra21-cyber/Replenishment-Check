"use client";

import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  LANG_COOKIE,
  isRtl,
  localeOf,
  lookup,
  translate,
  type Lang,
  type Translate,
  type Vars,
} from "./core";

type RichVars = Record<string, ReactNode>;

type I18n = {
  lang: Lang;
  locale: string;
  rtl: boolean;
  setLang: (lang: Lang) => void;
  t: Translate;
  // Like t, but placeholders may be React nodes, e.g. a bold store name.
  rich: (key: string, vars: RichVars) => ReactNode;
};

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ initialLang, children }: { initialLang: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    // The server reads the cookie to render the next page load in this language.
    document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next;
    document.documentElement.dir = isRtl(next) ? "rtl" : "ltr";
  }, []);

  const value = useMemo<I18n>(() => {
    const t: Translate = (key, vars) => translate(lang, key, vars);
    const rich = (key: string, vars: RichVars) => {
      const numeric: Vars = {};
      for (const [name, v] of Object.entries(vars)) {
        if (typeof v === "number") numeric[name] = v;
      }
      const parts = lookup(lang, key, numeric).split(/(\{\w+\})/);
      return parts.map((part, index) => {
        const name = /^\{(\w+)\}$/.exec(part)?.[1];
        return <Fragment key={index}>{name && name in vars ? vars[name] : part}</Fragment>;
      });
    };
    return { lang, locale: localeOf(lang), rtl: isRtl(lang), setLang, t, rich };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n outside I18nProvider");
  return value;
}

export function useT(): Translate {
  return useI18n().t;
}
