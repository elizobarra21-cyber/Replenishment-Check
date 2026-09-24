"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ALL_SIZE_SYSTEMS,
  DEFAULT_FRONTS,
  MAX_FRONT_CAPACITY,
  SIZE_POOLS,
  buildTargetSizes,
  categoryOf,
  defaultGridLayout,
  genderOf,
  orderSizes,
  sizeSystemFromParts,
  targetTotal,
  type FrontOption,
  type Gender,
  type GridLayout,
  type SizeCategory,
  type SizeLayout,
  type SizeSystem,
} from "@/lib/replenishment";
import { CTA, FIELD_LABEL, INPUT, LABEL, SECONDARY, Section, SettingsShell, StatusText } from "../ui";

// Editable copy of the whole layout: every grid filled in (defaults where the
// user has no override), plus the fronts list.
type Draft = { grids: Record<SizeSystem, GridLayout>; fronts: FrontOption[] };
type TileState = "main" | "optional" | "off";

const CATEGORIES: Array<{ value: SizeCategory; label: string }> = [
  { value: "letter", label: "Letter" },
  { value: "small", label: "Jeans" },
  { value: "large", label: "Numeric" },
  { value: "shirt", label: "Shirt" },
];

function draftFromLayout(layout: SizeLayout | null): Draft {
  const grids = {} as Record<SizeSystem, GridLayout>;
  for (const system of ALL_SIZE_SYSTEMS) {
    const g = layout?.grids?.[system];
    grids[system] = g
      ? { mandatory: [...g.mandatory], optional: [...g.optional], custom: [...(g.custom ?? [])] }
      : { ...defaultGridLayout(system), custom: [] };
  }
  return { grids, fronts: (layout?.fronts ?? DEFAULT_FRONTS).map((f) => ({ ...f })) };
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

function isDefaultGrid(system: SizeSystem, grid: GridLayout): boolean {
  const def = defaultGridLayout(system);
  return (
    sameSet(grid.mandatory, def.mandatory) &&
    sameSet(grid.optional, def.optional) &&
    (grid.custom ?? []).length === 0
  );
}

function sameFronts(a: FrontOption[], b: FrontOption[]): boolean {
  return (
    a.length === b.length &&
    a.every((f, i) => f.capacity === b[i].capacity && (f.name ?? "") === (b[i].name ?? ""))
  );
}

// Only what differs from the defaults is stored; nothing differing -> null.
function layoutFromDraft(draft: Draft): SizeLayout | null {
  const layout: SizeLayout = {};
  const grids: Partial<Record<SizeSystem, GridLayout>> = {};
  for (const system of ALL_SIZE_SYSTEMS) {
    const g = draft.grids[system];
    if (isDefaultGrid(system, g)) continue;
    grids[system] = {
      mandatory: orderSizes(g.mandatory),
      optional: orderSizes(g.optional),
      ...(g.custom?.length ? { custom: orderSizes(g.custom) } : {}),
    };
  }
  if (Object.keys(grids).length) layout.grids = grids;
  const fronts = [...draft.fronts]
    .map((f) => (f.name?.trim() ? { capacity: f.capacity, name: f.name.trim() } : { capacity: f.capacity }))
    .sort((a, b) => a.capacity - b.capacity);
  if (!sameFronts(fronts, DEFAULT_FRONTS)) layout.fronts = fronts;
  return layout.grids || layout.fronts ? layout : null;
}

function gridTitle(system: SizeSystem): string {
  const cat = CATEGORIES.find((c) => c.value === categoryOf(system))?.label ?? "";
  return `${genderOf(system) === "men" ? "Men" : "Women"} · ${cat}`;
}

// Repeated tokens in size order, e.g. { S: 2, M: 1 } -> ["S", "S", "M"].
function tokens(map: Record<string, number>): string[] {
  return orderSizes(Object.keys(map)).flatMap((size) =>
    Array.from({ length: map[size] ?? 0 }, () => size),
  );
}

function SizeTile({ size, state, onTap }: { size: string; state: TileState; onTap: () => void }) {
  const cls =
    state === "main"
      ? "border-accent bg-accent text-white"
      : state === "optional"
        ? "border-dashed border-black/50 bg-white text-black"
        : "border-black/10 bg-white text-black/30";
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={`${size}: ${state}`}
      className={`flex h-12 min-w-12 flex-col items-center justify-center border px-2 transition-colors active:scale-[0.96] ${cls}`}
    >
      <span className="text-sm font-semibold leading-none">{state === "optional" ? `${size}?` : size}</span>
    </button>
  );
}

export default function LayoutEditorPage() {
  const router = useRouter();
  const [saved, setSaved] = useState<SizeLayout | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [system, setSystem] = useState<SizeSystem>("letter");
  const [customSize, setCustomSize] = useState("");
  const [customError, setCustomError] = useState("");
  const [newFrontCapacity, setNewFrontCapacity] = useState("");
  const [newFrontName, setNewFrontName] = useState("");
  const [frontError, setFrontError] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/layout");
        if (res.status === 401) {
          router.replace("/");
          return;
        }
        if (!res.ok) throw new Error();
        const layout = ((await res.json()).layout ?? null) as SizeLayout | null;
        setSaved(layout);
        setDraft(draftFromLayout(layout));
      } catch {
        setLoadError("Could not load your layout. Check the connection and retry.");
      }
    })();
  }, [router]);

  const draftLayout = useMemo(() => (draft ? layoutFromDraft(draft) : null), [draft]);
  const dirty = draft !== null && JSON.stringify(draftLayout) !== JSON.stringify(saved);
  const invalidGrids = draft
    ? ALL_SIZE_SYSTEMS.filter((s) => draft.grids[s].mandatory.length === 0)
    : [];

  if (!draft) {
    return (
      <SettingsShell title="Customize layout" backHref="/settings">
        <p className="text-sm text-black/50">{loadError || "Loading..."}</p>
      </SettingsShell>
    );
  }

  const grid = draft.grids[system];
  const def = defaultGridLayout(system);
  const pool = orderSizes([
    ...SIZE_POOLS[system],
    ...def.mandatory,
    ...def.optional,
    ...(grid.custom ?? []),
    ...grid.mandatory,
    ...grid.optional,
  ]);
  const stateOf = (size: string): TileState =>
    grid.mandatory.includes(size) ? "main" : grid.optional.includes(size) ? "optional" : "off";

  function updateGrid(next: GridLayout) {
    setDraft((d) => (d ? { ...d, grids: { ...d.grids, [system]: next } } : d));
    setStatus(null);
  }

  // Tap cycles: off -> main -> optional -> off.
  function cycle(size: string) {
    const st = stateOf(size);
    const mandatory = grid.mandatory.filter((s) => s !== size);
    const optional = grid.optional.filter((s) => s !== size);
    if (st === "off") mandatory.push(size);
    if (st === "main") optional.push(size);
    updateGrid({ ...grid, mandatory, optional });
  }

  function addCustomSize(event: FormEvent) {
    event.preventDefault();
    const size = customSize.trim().toUpperCase();
    if (!/^[A-Z0-9/.-]{1,8}$/.test(size)) {
      setCustomError("Use up to 8 letters/digits, e.g. 3XL or 35.");
      return;
    }
    if (pool.includes(size)) {
      setCustomError(`${size} is already in this grid - tap its tile.`);
      return;
    }
    // A new size starts as a main size; tap it to make it optional or remove it.
    updateGrid({
      mandatory: [...grid.mandatory, size],
      optional: grid.optional,
      custom: [...(grid.custom ?? []), size],
    });
    setCustomSize("");
    setCustomError("");
  }

  function removeCustomSize(size: string) {
    updateGrid({
      mandatory: grid.mandatory.filter((s) => s !== size),
      optional: grid.optional.filter((s) => s !== size),
      custom: (grid.custom ?? []).filter((s) => s !== size),
    });
  }

  function setFronts(fronts: FrontOption[]) {
    setDraft((d) => (d ? { ...d, fronts } : d));
    setStatus(null);
  }

  function addFront(event: FormEvent) {
    event.preventDefault();
    const capacity = Math.floor(Number(newFrontCapacity));
    if (!Number.isFinite(capacity) || capacity < 1 || capacity > MAX_FRONT_CAPACITY) {
      setFrontError(`Capacity must be a number from 1 to ${MAX_FRONT_CAPACITY}.`);
      return;
    }
    if (draft?.fronts.some((f) => f.capacity === capacity)) {
      setFrontError(`There is already a front for ${capacity} pieces.`);
      return;
    }
    const name = newFrontName.trim().slice(0, 24);
    setFronts(
      [...(draft?.fronts ?? []), name ? { capacity, name } : { capacity }].sort(
        (a, b) => a.capacity - b.capacity,
      ),
    );
    setNewFrontCapacity("");
    setNewFrontName("");
    setFrontError("");
  }

  async function save() {
    if (!draft || invalidGrids.length) return;
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout: draftLayout }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Could not save.");
      const stored = (json.layout ?? null) as SizeLayout | null;
      setSaved(stored);
      setDraft(draftFromLayout(stored));
      setStatus({ kind: "ok", text: "Layout saved. New items use it right away." });
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const gender = genderOf(system);
  const category = categoryOf(system);
  const chip = (active: boolean) =>
    `relative flex-1 border px-2 py-2 text-sm font-semibold transition-colors active:scale-[0.98] ${
      active ? "border-accent bg-accent-soft text-accent" : "border-black/10 bg-white text-black/60"
    }`;
  const regularTarget = targetTotal(buildTargetSizes(system, null, draftLayout));

  return (
    <SettingsShell
      title="Customize layout"
      backHref="/settings"
      backLabel="Settings"
      onBack={() => (dirty ? setConfirmLeave(true) : router.push("/settings"))}
    >
      {confirmLeave ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm border border-black/10 bg-white p-5">
            <p className={LABEL}>Unsaved changes</p>
            <p className="mt-2 text-sm text-black/60">Leave without saving your layout changes?</p>
            <div className="mt-4 flex gap-2">
              <button type="button" className={`flex-1 ${SECONDARY} py-3`} onClick={() => setConfirmLeave(false)}>
                Stay
              </button>
              <button
                type="button"
                className="flex-1 bg-accent px-3 py-3 text-[12px] font-semibold uppercase tracking-[0.04em] text-white"
                onClick={() => router.push("/settings")}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <Section
        title="Size grids"
        description="Tap a size to cycle: main → optional → not offered. Main sizes count toward the target; optional ones are offered in the hall and suggested in the warehouse only if available."
      >
        <div className="space-y-1.5">
          <div className="flex gap-1.5">
            {(["women", "men"] as Gender[]).map((g) => (
              <button
                key={g}
                type="button"
                className={chip(gender === g)}
                onClick={() => setSystem(sizeSystemFromParts(g, category))}
              >
                {g === "women" ? "Women" : "Men"}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            {CATEGORIES.filter((c) => gender === "men" || c.value !== "shirt").map((c) => {
              const target = sizeSystemFromParts(gender, c.value);
              const changed = !isDefaultGrid(target, draft.grids[target]);
              return (
                <button
                  key={c.value}
                  type="button"
                  className={chip(category === c.value)}
                  onClick={() => setSystem(target)}
                >
                  {c.label}
                  {changed ? (
                    <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" aria-label="customized" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5 border border-black/10 bg-white p-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className={LABEL}>{gridTitle(system)}</p>
            {!isDefaultGrid(system, grid) ? (
              <button
                type="button"
                className="text-[11px] font-semibold uppercase tracking-wide text-black/45 underline underline-offset-2"
                onClick={() => updateGrid({ ...def, custom: [] })}
              >
                Reset grid
              </button>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {pool.map((size) => (
              <SizeTile key={size} size={size} state={stateOf(size)} onTap={() => cycle(size)} />
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-black/50">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 border border-accent bg-accent" /> main
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 border border-dashed border-black/50" /> optional
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 border border-black/10" /> not offered
            </span>
          </div>

          {grid.mandatory.length === 0 ? (
            <p className="mt-3 text-sm text-danger">Pick at least one main size - it defines the target.</p>
          ) : (
            <dl className="mt-3 space-y-1 border-t border-black/10 pt-3 text-sm">
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-black/50">Regular item</dt>
                <dd className="font-semibold">
                  {orderSizes(grid.mandatory).join(" ")}
                  <span className="font-normal text-black/45"> · target {regularTarget}</span>
                </dd>
              </div>
              {grid.optional.length ? (
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-black/50">Optional</dt>
                  <dd>{orderSizes(grid.optional).join(" ")}</dd>
                </div>
              ) : null}
              {draft.fronts.map((f) => (
                <div key={f.capacity} className="flex gap-2">
                  <dt className="w-24 shrink-0 truncate text-black/50">{f.name || `Front ${f.capacity}`}</dt>
                  <dd className="text-black/80">
                    {tokens(buildTargetSizes(system, f.capacity, draftLayout)).join(" ")}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          <form onSubmit={addCustomSize} className="mt-3 border-t border-black/10 pt-3">
            <label className={FIELD_LABEL}>
              Add a size to this grid
              <div className="mt-1 flex gap-2">
                <input
                  value={customSize}
                  onChange={(e) => {
                    setCustomSize(e.target.value);
                    setCustomError("");
                  }}
                  placeholder="e.g. 3XL"
                  autoCapitalize="characters"
                  maxLength={8}
                  className={`${INPUT} mt-0 flex-1`}
                />
                <button type="submit" className={SECONDARY} disabled={!customSize.trim()}>
                  Add
                </button>
              </div>
            </label>
            {customError ? <p className="mt-1.5 text-sm text-danger">{customError}</p> : null}
            {grid.custom?.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {orderSizes(grid.custom).map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => removeCustomSize(size)}
                    className="border border-black/10 px-2 py-1 text-xs text-black/60"
                    aria-label={`Remove ${size}`}
                  >
                    {size} ×
                  </button>
                ))}
              </div>
            ) : null}
          </form>
        </div>
      </Section>

      <Section
        title="Fronts"
        description="A front is filled up to its capacity with the grid's main and optional sizes, doubling the most popular ones."
      >
        {draft.fronts.length === 0 ? (
          <p className="text-sm text-black/50">No fronts - items can only be regular.</p>
        ) : (
          <ul className="divide-y divide-black/10 border border-black/10 bg-white">
            {draft.fronts.map((f) => (
              <li key={f.capacity} className="flex items-center gap-2 px-3 py-2">
                <input
                  value={f.name ?? ""}
                  onChange={(e) =>
                    setFronts(
                      draft.fronts.map((x) =>
                        x.capacity === f.capacity ? { ...x, name: e.target.value.slice(0, 24) } : x,
                      ),
                    )
                  }
                  placeholder={`Front ${f.capacity}`}
                  aria-label={`Name of the ${f.capacity}-piece front`}
                  className="min-w-0 flex-1 border border-transparent px-1 py-1.5 text-sm font-semibold outline-none focus:border-black/15"
                />
                <span className="shrink-0 text-xs text-black/45">{f.capacity} pcs</span>
                <button
                  type="button"
                  onClick={() => setFronts(draft.fronts.filter((x) => x.capacity !== f.capacity))}
                  className="shrink-0 px-2 py-1 text-lg leading-none text-black/40"
                  aria-label={`Remove ${f.name || `Front ${f.capacity}`}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={addFront} className="mt-3 flex items-end gap-2">
          <label className={`w-24 shrink-0 ${FIELD_LABEL}`}>
            Pieces
            <input
              value={newFrontCapacity}
              onChange={(e) => {
                setNewFrontCapacity(e.target.value.replace(/\D/g, "").slice(0, 2));
                setFrontError("");
              }}
              inputMode="numeric"
              placeholder="10"
              className={INPUT}
            />
          </label>
          <label className={`min-w-0 flex-1 ${FIELD_LABEL}`}>
            Name (optional)
            <input
              value={newFrontName}
              onChange={(e) => setNewFrontName(e.target.value.slice(0, 24))}
              placeholder="e.g. Table"
              className={INPUT}
            />
          </label>
          <button type="submit" className={`${SECONDARY} py-3`} disabled={!newFrontCapacity}>
            Add
          </button>
        </form>
        {frontError ? <p className="mt-1.5 text-sm text-danger">{frontError}</p> : null}
      </Section>

      <section className="pb-4">
        <button
          type="button"
          className="text-[11px] font-semibold uppercase tracking-wide text-black/45 underline underline-offset-2"
          onClick={() => {
            setDraft(draftFromLayout(null));
            setStatus(null);
          }}
        >
          Reset everything to defaults
        </button>
      </section>

      {/* Sticky save bar, like "Add to list" on the main screen. */}
      <div className="sticky bottom-0 -mx-4 border-t border-black/10 bg-white/95 px-4 pb-4 pt-3 backdrop-blur">
        {invalidGrids.length ? (
          <p className="mb-2 text-sm text-danger">
            No main size in: {invalidGrids.map(gridTitle).join(", ")}
          </p>
        ) : null}
        <StatusText status={status} />
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving || invalidGrids.length > 0}
          className={`mt-2 ${CTA}`}
        >
          {saving ? "Saving..." : dirty ? "Save layout" : "Saved"}
        </button>
      </div>
    </SettingsShell>
  );
}
