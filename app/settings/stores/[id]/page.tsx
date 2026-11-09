"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CTA, SECONDARY, Section, SettingsShell, StatusText } from "../../ui";

type Member = {
  userId: string;
  role: "ADMIN" | "MEMBER";
  user: { username: string };
};

type StoreDetails = {
  id: string;
  name: string;
  inviteCode: string;
  layoutUpdatedAt: string | null;
  layoutUpdatedBy: string | null;
  members: Member[];
};

type StoreSession = {
  id: string;
  status: string;
  createdBy: string;
  startedAt: string;
  _count: { items: number };
};

type SessionItem = {
  id: string;
  article: string;
  color: string | null;
  storageSection: string | null;
  presentSizesQty: Record<string, number>;
  neededSizesQty: Record<string, number>;
};

type Status = { kind: "ok" | "error"; text: string } | null;

function sizeList(map: Record<string, number>): string {
  const tokens = Object.entries(map).flatMap(([size, qty]) =>
    Array.from({ length: Math.max(0, Number(qty) || 0) }, () => size),
  );
  return tokens.length ? tokens.join(" ") : "-";
}

// Store administrators: invite link, people and roles, everyone's sessions (read only).
export default function StorePage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [store, setStore] = useState<StoreDetails | null>(null);
  const [sessions, setSessions] = useState<StoreSession[]>([]);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, SessionItem[]>>({});

  const load = useCallback(async () => {
    const res = await fetch(`/api/stores/${id}`).catch(() => null);
    if (res?.status === 401 || res?.status === 403) {
      router.replace("/settings");
      return;
    }
    if (!res?.ok) {
      setStatus({ kind: "error", text: "Could not load the store." });
      return;
    }
    setStore((await res.json()).store);
    const sres = await fetch(`/api/stores/${id}/sessions`).catch(() => null);
    if (sres?.ok) setSessions((await sres.json()).sessions);
  }, [id, router]);

  useEffect(() => {
    setOrigin(window.location.origin);
    void load();
  }, [load]);

  async function run(action: () => Promise<Response>, done?: string) {
    setBusy(true);
    setStatus(null);
    const res = await action().catch(() => null);
    if (res?.ok) {
      if (done) setStatus({ kind: "ok", text: done });
      await load();
    } else {
      setStatus({ kind: "error", text: "Could not save. Check the connection and retry." });
    }
    setBusy(false);
  }

  const setRole = (member: Member, role: Member["role"]) =>
    run(() =>
      fetch(`/api/stores/${id}/members/${member.userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      }),
    );

  const removeMember = (member: Member) =>
    run(() => fetch(`/api/stores/${id}/members/${member.userId}`, { method: "DELETE" }));

  const regenerate = () =>
    run(
      () =>
        fetch(`/api/stores/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ regenerateCode: true }),
        }),
      "New link created. The old one no longer works.",
    );

  async function toggleSession(sessionId: string) {
    if (expanded === sessionId) {
      setExpanded(null);
      return;
    }
    setExpanded(sessionId);
    if (items[sessionId]) return;
    const res = await fetch(`/api/requests/${sessionId}`).catch(() => null);
    if (res?.ok) {
      const json = await res.json();
      setItems((prev) => ({ ...prev, [sessionId]: json.request?.items ?? [] }));
    }
  }

  if (!store) {
    return (
      <SettingsShell title="Store" backHref="/settings" backLabel="Settings">
        <StatusText status={status} />
        {status ? null : <p className="text-sm text-black/50">Loading...</p>}
      </SettingsShell>
    );
  }

  const inviteLink = `${origin}/join/${store.inviteCode}`;

  return (
    <SettingsShell title={store.name} backHref="/settings" backLabel="Settings">
      <Section
        title="Store rules"
        description={
          store.layoutUpdatedAt
            ? `Size grids and fronts for everyone here. Last changed by ${store.layoutUpdatedBy} on ${new Date(store.layoutUpdatedAt).toLocaleDateString()}.`
            : "Size grids and fronts for everyone here. Standard rules so far."
        }
      >
        <Link href={`/settings/stores/${id}/layout`} className={`block text-center ${CTA}`}>
          Change store rules
        </Link>
      </Section>

      <Section title="Invite link" description="Send it to new employees. They join this store when they open it.">
        <p className="break-all border border-black/10 bg-white px-3 py-2.5 text-sm">{inviteLink}</p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            className={`flex-1 ${SECONDARY}`}
            onClick={() => {
              void navigator.clipboard
                ?.writeText(inviteLink)
                .then(() => setStatus({ kind: "ok", text: "Link copied." }));
            }}
          >
            Copy link
          </button>
          <button type="button" className={`flex-1 ${SECONDARY}`} disabled={busy} onClick={() => void regenerate()}>
            New link
          </button>
        </div>
        <StatusText status={status} />
      </Section>

      <Section title={`People (${store.members.length})`}>
        {store.members.length === 0 ? (
          <p className="text-sm text-black/50">Nobody has joined yet.</p>
        ) : (
          <ul className="divide-y divide-black/10 border border-black/10 bg-white">
            {store.members.map((member) => (
              <li key={member.userId} className="flex items-center gap-2 px-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate font-semibold">{member.user.username}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void setRole(member, member.role === "ADMIN" ? "MEMBER" : "ADMIN")}
                  className={`shrink-0 border px-2 py-1 text-xs font-semibold disabled:opacity-40 ${
                    member.role === "ADMIN"
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-black/15 text-black/55"
                  }`}
                >
                  {member.role === "ADMIN" ? "Admin" : "Make admin"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removeMember(member)}
                  aria-label={`Remove ${member.user.username}`}
                  className="shrink-0 px-1.5 text-lg leading-none text-black/40 disabled:opacity-40"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Sessions" description="Everyone's sessions in this store. View only.">
        {sessions.length === 0 ? (
          <p className="text-sm text-black/50">No sessions yet.</p>
        ) : (
          <ul className="divide-y divide-black/10 border border-black/10 bg-white">
            {sessions.map((session) => (
              <li key={session.id} className="px-3 py-2 text-xs">
                <button
                  type="button"
                  onClick={() => void toggleSession(session.id)}
                  className="flex w-full items-center justify-between gap-2 text-left"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{session.createdBy}</span>
                    <span className="text-black/50"> · {new Date(session.startedAt).toLocaleString()}</span>
                  </span>
                  <span className="shrink-0 text-black/45">
                    {session._count.items} items · {session.status.toLowerCase()}
                  </span>
                </button>
                {expanded === session.id ? (
                  <div className="mt-2 border-t border-black/5 pt-2">
                    <ul className="space-y-1">
                      {(items[session.id] ?? []).map((item) => (
                        <li key={item.id} className="truncate">
                          <span className="text-black/40">{item.storageSection ?? "-"}</span>{" "}
                          <span className="font-bold">{item.article}</span>{" "}
                          <span className="text-black/45">{item.color}</span>{" "}
                          <span className="text-black/55">p: {sizeList(item.presentSizesQty)}</span>{" "}
                          <span className="font-semibold">n: {sizeList(item.neededSizesQty)}</span>
                        </li>
                      ))}
                    </ul>
                    <a
                      href={`/api/requests/${session.id}/report`}
                      download
                      className={`mt-2 inline-block ${SECONDARY}`}
                    >
                      Download PDF
                    </a>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </SettingsShell>
  );
}
