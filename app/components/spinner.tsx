"use client";

import { useI18n } from "@/lib/i18n/react";

// Small "thinking" indicators: a spinning ring that inherits the text color,
// and a centered full-screen variant for first loads.

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px] motion-reduce:animate-none ${className}`}
    />
  );
}

// Text with a spinner in front, for buttons and inline "Loading..." lines.
export function Busy({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center justify-center gap-2">
      <Spinner />
      {children}
    </span>
  );
}

export function LoadingScreen({ text }: { text?: string }) {
  const { t } = useI18n();
  return (
    <div
      role="status"
      className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center gap-2 p-6 text-sm text-black/50"
    >
      <Spinner />
      {text ?? t("Loading...")}
    </div>
  );
}
