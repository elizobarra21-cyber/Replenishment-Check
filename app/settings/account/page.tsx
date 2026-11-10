"use client";

import { AccountSettings } from "../account-settings";
import { useI18n } from "@/lib/i18n/react";
import { SettingsShell } from "../ui";

// Account screen for store and network administrators.
export default function AccountPage() {
  const { t } = useI18n();
  return (
    <SettingsShell title={t("Account")} backHref="/settings" backLabel={t("Settings")}>
      <AccountSettings />
    </SettingsShell>
  );
}
