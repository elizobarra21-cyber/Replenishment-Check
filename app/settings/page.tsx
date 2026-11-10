"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearStoredSession } from "@/lib/client-storage";
import { Busy } from "../components/spinner";
import { AccountSettings } from "./account-settings";
import { CTA, FIELD_LABEL, INPUT, NavRow, SECONDARY, Section, SettingsShell, StatusText } from "./ui";

type Status = { kind: "ok" | "error"; text: string } | null;

type StoreRef = { id: string; name: string };

type StoreState = {
  storesExist: boolean;
  activeStore: { id: string; name: string; canManage: boolean } | null;
  defaultStoreId: string | null;
  defaultStoreName: string | null;
  canPickStore: boolean;
  isNetworkAdmin: boolean;
  managedStores: StoreRef[];
  stores: StoreRef[];
};

// Settings by role:
// - employee: one screen - account, password and which store they belong to;
// - store administrator: Account opens separately, then "My store";
// - network administrator: the same plus "Store network".
export default function SettingsPage() {
  const router = useRouter();
  const [stores, setStores] = useState<StoreState | null>(null);
  const [storeStatus, setStoreStatus] = useState<Status>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/stores/me").catch(() => null);
      if (res?.status === 401) {
        router.replace("/");
        return;
      }
      if (res?.ok) setStores(await res.json());
      else setLoadError("Could not load your settings. Check the connection and retry.");
    })();
  }, [router]);

  async function saveDefaultStore(defaultStoreId: string) {
    if (!defaultStoreId) return;
    setStoreStatus(null);
    const res = await fetch("/api/stores/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultStoreId }),
    }).catch(() => null);
    if (res?.ok) {
      setStores(await res.json());
      setStoreStatus({ kind: "ok", text: "Default store saved." });
    } else {
      setStoreStatus({ kind: "error", text: "Could not save. Check the connection and retry." });
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    clearStoredSession();
    router.replace("/");
  }

  if (!stores) {
    return (
      <SettingsShell title="Settings" backHref="/">
        <p className="text-sm text-black/50">{loadError || <Busy>Loading...</Busy>}</p>
      </SettingsShell>
    );
  }

  const isManager = stores.isNetworkAdmin || stores.managedStores.length > 0;
  const showStore = stores.storesExist || stores.isNetworkAdmin;
  const workingElsewhere =
    stores.activeStore && stores.activeStore.id !== stores.defaultStoreId ? stores.activeStore : null;

  // Stores this person can open from "My store": the ones they administer, and
  // for the network administrator also the store they're working in now.
  const manageable: StoreRef[] = [...stores.managedStores];
  if (stores.activeStore?.canManage && !manageable.some((s) => s.id === stores.activeStore?.id)) {
    manageable.unshift({ id: stores.activeStore.id, name: stores.activeStore.name });
  }

  const logoutButton = (
    <section className="border-t border-black/10 pt-6 pb-8">
      <button type="button" onClick={() => void logout()} className={`w-full ${SECONDARY} py-3`}>
        Log out
      </button>
    </section>
  );

  if (!isManager) {
    return (
      <SettingsShell title="Settings" backHref="/">
        <AccountSettings />
        {showStore ? (
          <Section title="Store">
            <p className="text-sm text-black/70">
              {stores.defaultStoreName ? (
                <>
                  You belong to <span className="font-semibold">{stores.defaultStoreName}</span>.
                </>
              ) : (
                "You don't belong to a store yet."
              )}
            </p>
            {workingElsewhere ? (
              <p className="mt-1 text-sm text-black/55">
                Working now in {workingElsewhere.name} (shift).
              </p>
            ) : null}
          </Section>
        ) : null}
        {logoutButton}
      </SettingsShell>
    );
  }

  return (
    <SettingsShell title="Settings" backHref="/">
      <NavRow href="/settings/account" title="Account" hint="Username, email, password" />

      {showStore ? (
        <Section title="My store">
          {workingElsewhere ? (
            <p className="text-sm text-black/70">Working now in {workingElsewhere.name} (shift).</p>
          ) : null}
          {stores.canPickStore && stores.stores.length ? (
            <label className={`block ${workingElsewhere ? "mt-3" : ""} ${FIELD_LABEL}`}>
              Default store
              <select
                value={stores.defaultStoreId ?? ""}
                onChange={(e) => void saveDefaultStore(e.target.value)}
                className={INPUT}
              >
                {stores.defaultStoreId ? null : <option value="">Choose a store</option>}
                {stores.stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <StatusText status={storeStatus} />
          {manageable.length ? (
            <div className="mt-3 space-y-2">
              {manageable.map((store) => (
                <Link key={store.id} href={`/settings/stores/${store.id}`} className={`block text-center ${CTA}`}>
                  Manage {store.name}
                </Link>
              ))}
            </div>
          ) : null}
        </Section>
      ) : null}

      {stores.isNetworkAdmin ? (
        <NavRow href="/settings/stores" title="Store network" hint="Stores, people without a store" />
      ) : null}

      {logoutButton}
    </SettingsShell>
  );
}
