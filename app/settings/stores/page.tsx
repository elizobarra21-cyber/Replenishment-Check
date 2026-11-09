"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CTA, FIELD_LABEL, INPUT, Section, SettingsShell, StatusText } from "../ui";

type StoreRow = { id: string; name: string; _count: { members: number } };
type Status = { kind: "ok" | "error"; text: string } | null;

// Network administrators: every store, and creating new ones.
export default function StoresPage() {
  const router = useRouter();
  const [stores, setStores] = useState<StoreRow[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/stores").catch(() => null);
    if (res?.status === 401 || res?.status === 403) {
      router.replace("/settings");
      return;
    }
    if (res?.ok) setStores((await res.json()).stores);
    else setStatus({ kind: "error", text: "Could not load the stores." });
  }, [router]);

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
      setStatus({ kind: "ok", text: "Store created." });
      await load();
    } else {
      setStatus({
        kind: "error",
        text: typeof json.error === "string" ? json.error : "Could not create the store.",
      });
    }
    setBusy(false);
  }

  return (
    <SettingsShell title="All stores" backHref="/settings" backLabel="Settings">
      <Section title="Stores">
        {!stores ? (
          <p className="text-sm text-black/50">Loading...</p>
        ) : stores.length === 0 ? (
          <p className="text-sm text-black/50">No stores yet. Create the first one below.</p>
        ) : (
          <ul className="divide-y divide-black/10 border border-black/10 bg-white">
            {stores.map((store) => (
              <li key={store.id}>
                <Link
                  href={`/settings/stores/${store.id}`}
                  className="flex items-center justify-between gap-2 px-3 py-3 text-sm font-semibold"
                >
                  <span className="min-w-0 truncate">{store.name}</span>
                  <span className="shrink-0 text-xs font-normal text-black/45">
                    {store._count.members} people
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="New store">
        <form onSubmit={createStore} className="space-y-3">
          <label className={`block ${FIELD_LABEL}`}>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              className={INPUT}
            />
          </label>
          <button type="submit" disabled={busy || !name.trim()} className={CTA}>
            {busy ? "Creating..." : "Create store"}
          </button>
          <StatusText status={status} />
        </form>
      </Section>
    </SettingsShell>
  );
}
