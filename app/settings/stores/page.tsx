"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n/react";
import { Busy } from "../../components/spinner";
import { Collapsible, CTA, FIELD_LABEL, INPUT, Section, SettingsShell, StatusText } from "../ui";

type StoreRow = { id: string; name: string; _count: { members: number } };
type LooseUser = { id: string; username: string; createdAt: string };
type Status = { kind: "ok" | "error"; text: string } | null;

// Network administrators: every store, people without a store, new stores.
export default function StoreNetworkPage() {
  const router = useRouter();
  const { t, locale } = useI18n();
  const [stores, setStores] = useState<StoreRow[] | null>(null);
  const [loose, setLoose] = useState<LooseUser[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [looseStatus, setLooseStatus] = useState<Status>(null);
  const [addingId, setAddingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/stores").catch(() => null);
    if (res?.status === 401 || res?.status === 403) {
      router.replace("/settings");
      return;
    }
    if (!res?.ok) {
      setStatus({ kind: "error", text: t("Could not load the stores.") });
      return;
    }
    setStores((await res.json()).stores);
    const ures = await fetch("/api/stores/unassigned").catch(() => null);
    if (ures?.ok) setLoose((await ures.json()).users);
  }, [router, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createStore(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    const res = await fetch("/api/stores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    if (res?.ok) {
      setName("");
      setStatus({ kind: "ok", text: t("Store created.") });
      await load();
    } else {
      setStatus({
        kind: "error",
        text: typeof json.error === "string" ? t(json.error) : t("Could not create the store."),
      });
    }
    setBusy(false);
  }

  async function addToStore(user: LooseUser, storeId: string) {
    if (!storeId) return;
    const store = stores?.find((s) => s.id === storeId);
    setAddingId(user.id);
    setLooseStatus(null);
    const res = await fetch(`/api/stores/${storeId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    }).catch(() => null);
    if (res?.ok) {
      setLooseStatus({
        kind: "ok",
        text: store
          ? t("{user} added to {store}.", { user: user.username, store: store.name })
          : t("{user} added to the store.", { user: user.username }),
      });
      await load();
    } else {
      setLooseStatus({ kind: "error", text: t("Could not add. Check the connection and retry.") });
    }
    setAddingId(null);
  }

  return (
    <SettingsShell title={t("Store network")} backHref="/settings" backLabel={t("Settings")}>
      {!stores ? (
        <p className="text-sm text-black/50">
          {status?.kind === "error" ? status.text : <Busy>{t("Loading...")}</Busy>}
        </p>
      ) : (
        <>
          <Section title={t("Stores")}>
            {stores.length === 0 ? (
              <p className="text-sm text-black/50">{t("No stores yet. Create the first one below.")}</p>
            ) : (
              <Collapsible title={t("All stores")} count={stores.length}>
                <ul className="divide-y divide-black/10">
                  {stores.map((store) => (
                    <li key={store.id}>
                      <Link
                        href={`/settings/stores/${store.id}?from=network`}
                        className="flex items-center justify-between gap-2 px-4 py-3 text-sm font-semibold"
                      >
                        <span className="min-w-0 truncate">{store.name}</span>
                        <span className="shrink-0 text-xs font-normal text-black/45">
                          {t("{n} people", { n: store._count.members })}{" "}
                          <span className="inline-block rtl:rotate-180">›</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Collapsible>
            )}
          </Section>

          <Section
            title={t("People without a store")}
            description={t("New accounts without an invite link and people removed from their last store.")}
          >
            {loose.length === 0 ? (
              <p className="text-sm text-black/50">{t("Everyone belongs to a store.")}</p>
            ) : (
              <Collapsible title={t("People")} count={loose.length}>
                <ul className="divide-y divide-black/10">
                  {loose.map((user) => (
                    <li key={user.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{user.username}</span>
                        <span className="block text-xs text-black/45">
                          {t("since {date}", { date: new Date(user.createdAt).toLocaleDateString(locale) })}
                        </span>
                      </span>
                      {addingId === user.id ? (
                        <span className="shrink-0 text-xs text-black/50">
                          <Busy>{t("Adding...")}</Busy>
                        </span>
                      ) : stores.length ? (
                        <select
                          aria-label={t("Add {user} to a store", { user: user.username })}
                          value=""
                          disabled={addingId !== null}
                          onChange={(e) => void addToStore(user, e.target.value)}
                          className="w-36 shrink-0 border border-black/15 bg-white px-2 py-1.5 text-xs font-semibold"
                        >
                          <option value="">{t("Add to store")}</option>
                          {stores.map((store) => (
                            <option key={store.id} value={store.id}>
                              {store.name}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Collapsible>
            )}
            <StatusText status={looseStatus} />
          </Section>

          <Section title={t("New store")}>
            <form onSubmit={createStore} className="space-y-3">
              <label className={`block ${FIELD_LABEL}`}>
                {t("Name")}
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  className={INPUT}
                />
              </label>
              <button type="submit" disabled={busy || !name.trim()} className={CTA}>
                {busy ? <Busy>{t("Creating...")}</Busy> : t("Create store")}
              </button>
              <StatusText status={status} />
            </form>
          </Section>
        </>
      )}
    </SettingsShell>
  );
}
