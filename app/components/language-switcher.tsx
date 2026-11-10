"use client";

import { LANGS, isLang } from "@/lib/i18n/core";
import { useI18n } from "@/lib/i18n/react";

// Compact language picker for the main screen header and the sign-in screen.
// A native select: the phone shows its own list with the languages' own names.
export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  const current = LANGS.find((option) => option.code === lang) ?? LANGS[0];
  return (
    <label
      className={`relative flex h-8 items-center gap-1 border border-black/10 bg-white px-2 text-[11px] font-semibold tracking-[0.04em] text-black/70 ${className}`}
    >
      <GlobeIcon className="h-3.5 w-3.5 shrink-0" />
      <span aria-hidden="true">{current.short}</span>
      <select
        aria-label={t("Language")}
        value={lang}
        onChange={(event) => {
          if (isLang(event.target.value)) setLang(event.target.value);
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {LANGS.map((option) => (
          <option key={option.code} value={option.code}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z" />
    </svg>
  );
}
