"use client";

import { AccountSettings } from "../account-settings";
import { SettingsShell } from "../ui";

// Account screen for store and network administrators.
export default function AccountPage() {
  return (
    <SettingsShell title="Account" backHref="/settings" backLabel="Settings">
      <AccountSettings />
    </SettingsShell>
  );
}
