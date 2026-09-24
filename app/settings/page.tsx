"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { clearStoredSession } from "@/lib/client-storage";
import { frontLabel, frontsFor, type SizeLayout } from "@/lib/replenishment";
import {
  CTA,
  FIELD_LABEL,
  INPUT,
  SECONDARY,
  Section,
  SettingsShell,
  StatusText,
} from "./ui";

type Account = {
  id: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  hasPassword: boolean;
  hasGoogle: boolean;
  createdAt: string;
};

type Status = { kind: "ok" | "error"; text: string } | null;

async function patchAccount(body: Record<string, string>) {
  const res = await fetch("/api/account", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof json.error === "string" ? json.error : "Could not save.");
  }
  return json.account as Account;
}

export default function SettingsPage() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [layout, setLayout] = useState<SizeLayout | null>(null);
  const [loadError, setLoadError] = useState("");

  const [username, setUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<Status>(null);
  const [email, setEmail] = useState("");
  const [emailStatus, setEmailStatus] = useState<Status>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<Status>(null);
  const [busy, setBusy] = useState<"" | "username" | "email" | "password">("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/account");
        if (res.status === 401) {
          router.replace("/");
          return;
        }
        const json = await res.json();
        if (!res.ok) throw new Error();
        setAccount(json.account);
        setUsername(json.account.username);
        setEmail(json.account.email ?? "");
        const lres = await fetch("/api/layout");
        if (lres.ok) setLayout((await lres.json()).layout ?? null);
      } catch {
        setLoadError("Could not load your settings. Check the connection and retry.");
      }
    })();
  }, [router]);

  async function saveUsername(event: FormEvent) {
    event.preventDefault();
    setBusy("username");
    setUsernameStatus(null);
    try {
      const next = await patchAccount({ username });
      setAccount(next);
      setUsername(next.username);
      setUsernameStatus({ kind: "ok", text: "Username saved." });
    } catch (e) {
      setUsernameStatus({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy("");
    }
  }

  async function saveEmail(event: FormEvent) {
    event.preventDefault();
    setBusy("email");
    setEmailStatus(null);
    try {
      const next = await patchAccount({ email });
      setAccount(next);
      setEmail(next.email ?? "");
      setEmailStatus({ kind: "ok", text: "Email saved." });
    } catch (e) {
      setEmailStatus({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy("");
    }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordStatus(null);
    if (newPassword.length < 6) {
      setPasswordStatus({ kind: "error", text: "Password must be at least 6 characters." });
      return;
    }
    if (newPassword !== repeatPassword) {
      setPasswordStatus({ kind: "error", text: "The new passwords don't match." });
      return;
    }
    setBusy("password");
    try {
      const next = await patchAccount(
        account?.hasPassword ? { currentPassword, newPassword } : { newPassword },
      );
      setAccount(next);
      setCurrentPassword("");
      setNewPassword("");
      setRepeatPassword("");
      setPasswordStatus({ kind: "ok", text: "Password saved." });
    } catch (e) {
      setPasswordStatus({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy("");
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    clearStoredSession();
    router.replace("/");
  }

  if (!account) {
    return (
      <SettingsShell title="Settings" backHref="/">
        <p className="text-sm text-black/50">{loadError || "Loading..."}</p>
      </SettingsShell>
    );
  }

  const customGrids = Object.keys(layout?.grids ?? {}).length;
  const fronts = frontsFor(layout);
  const passwordType = showPasswords ? "text" : "password";

  return (
    <SettingsShell title="Settings" backHref="/">
      <Section title="Sign-in">
        <div className="flex flex-wrap gap-2">
          <span
            className={`border px-2.5 py-1.5 text-xs font-semibold ${
              account.hasGoogle ? "border-accent text-black" : "border-black/10 text-black/40"
            }`}
          >
            Google · {account.hasGoogle ? "linked" : "not linked"}
          </span>
          <span
            className={`border px-2.5 py-1.5 text-xs font-semibold ${
              account.hasPassword ? "border-accent text-black" : "border-black/10 text-black/40"
            }`}
          >
            Password · {account.hasPassword ? "set" : "not set"}
          </span>
        </div>
      </Section>

      <Section title="Account">
        <form onSubmit={saveUsername}>
          <label className={FIELD_LABEL}>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="none"
              autoComplete="username"
              className={INPUT}
            />
          </label>
          <div className="mt-2 flex justify-end">
            <button
              type="submit"
              className={SECONDARY}
              disabled={busy !== "" || username.trim().toLowerCase() === account.username}
            >
              {busy === "username" ? "Saving..." : "Save username"}
            </button>
          </div>
          <StatusText status={usernameStatus} />
        </form>

        <form onSubmit={saveEmail} className="mt-6">
          <label className={FIELD_LABEL}>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              autoCapitalize="none"
              autoComplete="email"
              className={INPUT}
            />
          </label>
          <p className="mt-1.5 text-xs text-black/45">
            {account.hasGoogle
              ? account.emailVerified
                ? "Confirmed by your Google account. Changing it doesn't unlink Google sign-in."
                : "Google sign-in stays linked to this account whatever email is shown here."
              : "Not linked to Google. A typed email is not used to sign in with Google."}
          </p>
          <div className="mt-2 flex justify-end">
            <button
              type="submit"
              className={SECONDARY}
              disabled={busy !== "" || email.trim().toLowerCase() === (account.email ?? "")}
            >
              {busy === "email" ? "Saving..." : "Save email"}
            </button>
          </div>
          <StatusText status={emailStatus} />
        </form>
      </Section>

      <Section
        title="Password"
        description="Passwords are stored encrypted, so they can't be shown - you can only set a new one."
      >
        <form onSubmit={savePassword} className="space-y-3">
          {account.hasPassword ? (
            <label className={`block ${FIELD_LABEL}`}>
              Current password
              <input
                type={passwordType}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                className={INPUT}
              />
            </label>
          ) : (
            <p className="text-xs text-black/45">
              You sign in with Google. Set a password to also sign in with your username.
            </p>
          )}
          <label className={`block ${FIELD_LABEL}`}>
            New password
            <input
              type={passwordType}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              className={INPUT}
            />
          </label>
          <label className={`block ${FIELD_LABEL}`}>
            Repeat new password
            <input
              type={passwordType}
              value={repeatPassword}
              onChange={(e) => setRepeatPassword(e.target.value)}
              autoComplete="new-password"
              className={INPUT}
            />
          </label>
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-black/55">
              <input
                type="checkbox"
                checked={showPasswords}
                onChange={(e) => setShowPasswords(e.target.checked)}
              />
              Show passwords
            </label>
            <button
              type="submit"
              className={SECONDARY}
              disabled={
                busy !== "" ||
                !newPassword ||
                (account.hasPassword && !currentPassword)
              }
            >
              {busy === "password"
                ? "Saving..."
                : account.hasPassword
                  ? "Change password"
                  : "Set password"}
            </button>
          </div>
          <StatusText status={passwordStatus} />
        </form>
      </Section>

      <Section
        title="Hall layout"
        description="Your own size grids (main / optional sizes) and fronts. They apply only to your account."
      >
        <p className="mb-3 text-sm text-black/70">
          {customGrids
            ? `${customGrids} grid${customGrids === 1 ? "" : "s"} customized`
            : "Default size grids"}
          {" · "}
          Fronts: {fronts.length ? fronts.map((f) => frontLabel(f.capacity, layout)).join(", ") : "none"}
        </p>
        <Link href="/settings/layout" className={`block text-center ${CTA}`}>
          Customize layout
        </Link>
      </Section>

      <section className="border-t border-black/10 pt-6 pb-8">
        <button type="button" onClick={() => void logout()} className={`w-full ${SECONDARY} py-3`}>
          Log out
        </button>
      </section>
    </SettingsShell>
  );
}
