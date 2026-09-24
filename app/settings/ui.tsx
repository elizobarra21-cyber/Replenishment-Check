"use client";

import Link from "next/link";
import type { ReactNode } from "react";

// Shared building blocks for the Settings screens, in the app's COS style:
// white surface, hairline borders, square corners, small caps labels.

export const LABEL = "text-[13px] font-semibold uppercase tracking-[0.04em] text-black";
export const FIELD_LABEL = "text-[11px] font-semibold uppercase tracking-wide text-black/50";
// Inputs sit inside FIELD_LABEL labels; Tailwind preflight makes them inherit
// the label's muted color/weight/tracking, so reset those explicitly.
export const INPUT =
  "mt-1 w-full border border-black/10 bg-white px-3 py-[11px] text-base font-normal normal-case tracking-normal text-black outline-none focus:border-accent";
export const CTA =
  "w-full bg-accent px-4 py-4 text-[13px] font-medium uppercase tracking-[0.04em] text-white active:scale-[0.99] disabled:opacity-40";
export const SECONDARY =
  "border border-black/15 bg-white px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-black active:scale-[0.98] disabled:opacity-40";

export function SettingsShell({
  title,
  backHref,
  backLabel = "Back",
  onBack,
  children,
}: {
  title: string;
  backHref: string;
  backLabel?: string;
  // When set, the back control is a button (e.g. to confirm unsaved changes).
  onBack?: () => void;
  children: ReactNode;
}) {
  const backClass =
    "text-[12px] font-semibold uppercase tracking-[0.06em] text-black/55 active:text-black";
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col p-4">
      <header className="flex items-center justify-between gap-3 border-b border-black/10 pb-3">
        {onBack ? (
          <button type="button" onClick={onBack} className={backClass}>
            ← {backLabel}
          </button>
        ) : (
          <Link href={backHref} className={backClass}>
            ← {backLabel}
          </Link>
        )}
        <h1 className="text-[12px] font-medium uppercase tracking-[0.08em] text-black">{title}</h1>
      </header>
      <main className="flex-1 space-y-10 pt-6">{children}</main>
    </div>
  );
}

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className={LABEL}>{title}</h2>
      {description ? <p className="mt-1 text-sm text-black/55">{description}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function StatusText({
  status,
}: {
  status: { kind: "ok" | "error"; text: string } | null;
}) {
  if (!status) return null;
  return (
    <p className={`mt-2 text-sm ${status.kind === "ok" ? "text-black/60" : "text-danger"}`}>
      {status.text}
    </p>
  );
}
