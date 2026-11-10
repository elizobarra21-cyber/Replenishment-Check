"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { msg } from "@/lib/i18n/core";
import { useI18n } from "@/lib/i18n/react";
import { Busy } from "../components/spinner";
import { FIELD_LABEL, INPUT, SECONDARY, Section, StatusText } from "./ui";

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
    // An English key; the screen shows it through t().
    throw new Error(typeof json.error === "string" ? json.error : msg("Could not save."));
  }
  return json.account as Account;
}

// Sign-in methods, username, email and password of the signed-in account.
// Regular employees see it on the main Settings screen; store and network
// administrators open it as a separate Account screen.
export function AccountSettings() {
  const router = useRouter();
  const { t } = useI18n();
  const [account, setAccount] = useState<Account | null>(null);
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
      } catch {
        // Translated at render, so t is not a dependency of this effect.
        setLoadError(msg("Could not load your account. Check the connection and retry."));
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
      setUsernameStatus({ kind: "ok", text: t("Username saved.") });
    } catch (e) {
      setUsernameStatus({ kind: "error", text: t((e as Error).message) });
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
      setEmailStatus({ kind: "ok", text: t("Email saved.") });
    } catch (e) {
      setEmailStatus({ kind: "error", text: t((e as Error).message) });
    } finally {
      setBusy("");
    }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordStatus(null);
    if (newPassword.length < 6) {
      setPasswordStatus({
        kind: "error",
        text: t("Password must be at least 6 characters."),
      });
      return;
    }
    if (newPassword !== repeatPassword) {
      setPasswordStatus({
        kind: "error",
        text: t("The new passwords don't match."),
      });
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
      setPasswordStatus({ kind: "ok", text: t("Password saved.") });
    } catch (e) {
      setPasswordStatus({ kind: "error", text: t((e as Error).message) });
    } finally {
      setBusy("");
    }
  }

  if (!account) {
    return <p className="text-sm text-black/50">{loadError ? t(loadError) : <Busy>{t("Loading...")}</Busy>}</p>;
  }

  const passwordType = showPasswords ? "text" : "password";

  return (
    <>
      <Section title={t("Sign-in")}>
        <div className="flex flex-wrap gap-2">
          <span
            className={`border px-2.5 py-1.5 text-xs font-semibold ${
              account.hasGoogle ? "border-accent text-black" : "border-black/10 text-black/40"
            }`}
          >
            {account.hasGoogle ? t("Google · linked") : t("Google · not linked")}
          </span>
          <span
            className={`border px-2.5 py-1.5 text-xs font-semibold ${
              account.hasPassword ? "border-accent text-black" : "border-black/10 text-black/40"
            }`}
          >
            {account.hasPassword ? t("Password · set") : t("Password · not set")}
          </span>
        </div>
      </Section>

      <Section title={t("Account")}>
        <form onSubmit={saveUsername}>
          <label className={FIELD_LABEL}>
            {t("Username")}
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
              {busy === "username" ? <Busy>{t("Saving...")}</Busy> : t("Save username")}
            </button>
          </div>
          <StatusText status={usernameStatus} />
        </form>

        <form onSubmit={saveEmail} className="mt-6">
          <label className={FIELD_LABEL}>
            {t("Email")}
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
                ? t("Confirmed by your Google account. Changing it doesn't unlink Google sign-in.")
                : t("Google sign-in stays linked to this account whatever email is shown here.")
              : t("Not linked to Google. A typed email is not used to sign in with Google.")}
          </p>
          <div className="mt-2 flex justify-end">
            <button
              type="submit"
              className={SECONDARY}
              disabled={busy !== "" || email.trim().toLowerCase() === (account.email ?? "")}
            >
              {busy === "email" ? <Busy>{t("Saving...")}</Busy> : t("Save email")}
            </button>
          </div>
          <StatusText status={emailStatus} />
        </form>
      </Section>

      <Section
        title={t("Password")}
        description={t("Passwords are stored encrypted, so they can't be shown - you can only set a new one.")}
      >
        <form onSubmit={savePassword} className="space-y-3">
          {account.hasPassword ? (
            <label className={`block ${FIELD_LABEL}`}>
              {t("Current password")}
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
              {t("You sign in with Google. Set a password to also sign in with your username.")}
            </p>
          )}
          <label className={`block ${FIELD_LABEL}`}>
            {t("New password")}
            <input
              type={passwordType}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              className={INPUT}
            />
          </label>
          <label className={`block ${FIELD_LABEL}`}>
            {t("Repeat new password")}
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
              {t("Show passwords")}
            </label>
            <button
              type="submit"
              className={SECONDARY}
              disabled={busy !== "" || !newPassword || (account.hasPassword && !currentPassword)}
            >
              {busy === "password" ? (
                <Busy>{t("Saving...")}</Busy>
              ) : account.hasPassword ? (
                t("Change password")
              ) : (
                t("Set password")
              )}
            </button>
          </div>
          <StatusText status={passwordStatus} />
        </form>
      </Section>
    </>
  );
}
