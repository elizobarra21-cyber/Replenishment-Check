import type { Translate } from "@/lib/i18n/core";
export type SizeQtyMap = Record<string, number>;

export const HALL_REQUIRED_SIZES = ["XS", "S", "M", "L", "XL"];

export const HALL_TARGET_QTY_BY_SIZE: SizeQtyMap = HALL_REQUIRED_SIZES.reduce<SizeQtyMap>(
  (acc, size) => {
    acc[size] = 1;
    return acc;
  },
  {},
);

export function normalizeSizeQty(input: Record<string, unknown>): SizeQtyMap {
  const result: SizeQtyMap = {};

  for (const [size, value] of Object.entries(input)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      continue;
    }
    result[size] = Math.floor(numeric);
  }

  return result;
}

export function computeNeededSizes(
  orderedSizes: string[],
  targetQtyBySize: SizeQtyMap,
  presentSizesQty: SizeQtyMap,
): SizeQtyMap {
  const needed: SizeQtyMap = {};

  for (const size of orderedSizes) {
    const targetQty = targetQtyBySize[size] ?? 1;
    const presentQty = presentSizesQty[size] ?? 0;
    const delta = targetQty - presentQty;
    if (delta > 0) {
      needed[size] = delta;
    }
  }

  return needed;
}

export function buildSubstitutePriority(
  orderedSizes: string[],
  presentSizesQty: SizeQtyMap,
): string[] {
  return [...orderedSizes]
    .filter((size) => (presentSizesQty[size] ?? 0) > 0)
    .sort((a, b) => {
      const qtyA = presentSizesQty[a] ?? 0;
      const qtyB = presentSizesQty[b] ?? 0;
      if (qtyA !== qtyB) {
        return qtyA - qtyB;
      }
      return orderedSizes.indexOf(a) - orderedSizes.indexOf(b);
    });
}

export function formatSizeQty(map: SizeQtyMap): string {
  const chunks = Object.entries(map)
    .filter(([, qty]) => qty > 0)
    .map(([size, qty]) => `${size} x${qty}`);

  return chunks.length ? chunks.join(", ") : "-";
}

// --- Size systems and front targets -----------------------------------------

// Six systems: three categories (letter / small=jeans / large=numeric), each in
// women's (default) and men's variants. Men's items are those whose department
// code starts with 45 (see isMenSection). Older stored items only ever use the
// women's names ("letter" / "small" / "large"), which stay valid here.
export type SizeSystem =
  | "letter"
  | "small"
  | "large"
  | "men-letter"
  | "men-small"
  | "men-large"
  | "men-shirt";

export type SizeCategory = "letter" | "small" | "large" | "shirt";
export type Gender = "women" | "men";

export const ALL_SIZE_SYSTEMS: SizeSystem[] = [
  "letter",
  "small",
  "large",
  "men-letter",
  "men-small",
  "men-large",
  "men-shirt",
];

type SizeConfig = {
  // Counted toward the target (Y in the "X of Y" indicator).
  mandatory: string[];
  // Selectable and (on the warehouse list) suggested only if in stock; never
  // counted toward the target for a regular item.
  optional: string[];
  // Sizes doubled first when filling a front to its capacity.
  doublePref: string[];
  // Sizes that matter most when not every size can be brought, best first:
  // listed first in "need", kept longest when a front is trimmed to capacity.
  priority?: string[];
};

const SIZE_CONFIGS: Record<SizeSystem, SizeConfig> = {
  letter: {
    mandatory: ["XS", "S", "M", "L", "XL"],
    optional: [],
    doublePref: ["M", "S", "L", "XS"],
    priority: ["M", "S", "L", "XS"],
  },
  small: {
    mandatory: ["25", "26", "27", "28", "29", "30", "31"],
    optional: ["24", "32"],
    doublePref: ["25", "26", "27", "28", "29", "30", "31"],
  },
  large: {
    mandatory: ["34", "36", "38", "40", "42"],
    optional: ["44"],
    doublePref: ["38", "40", "36", "42", "34", "44"],
    priority: ["38", "40", "36"],
  },
  // Men's letter grid: 4 mandatory sizes; XS is optional (suggested in the
  // warehouse only as a "bring if available" hint, never counted in the target).
  "men-letter": {
    mandatory: ["S", "M", "L", "XL"],
    optional: ["XS"],
    doublePref: ["L", "XL", "M"],
    priority: ["L", "XL", "M"],
  },
  "men-small": {
    mandatory: ["29", "30", "31", "32", "33"],
    optional: ["28", "34"],
    doublePref: ["29", "30", "31", "32", "33"],
  },
  // Like men-letter: 4 mandatory sizes, the smallest is optional.
  "men-large": {
    mandatory: ["46", "48", "50", "52"],
    optional: ["44", "54"],
    doublePref: ["48", "50", "52", "46", "44", "54"],
    priority: ["48", "50", "52"],
  },
  // Men's shirts (collar sizes): 4 mandatory, both ends optional.
  "men-shirt": {
    mandatory: ["39", "40", "41", "42"],
    optional: ["38", "43"],
    doublePref: ["39", "40", "41"],
  },
};

const LETTER_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];

// --- Per-user layout (Settings -> Customize layout) --------------------------

// A user's override for one size grid: which sizes count toward the target
// (mandatory), which are offered but only "bring if available" (optional), and
// any custom sizes the user added to the tile pool (kept even while switched off).
export type GridLayout = {
  mandatory: string[];
  optional: string[];
  custom?: string[];
};

// A front (display rack) is identified by its capacity; items store only the
// capacity (RequestItem.frontSize), the name is a display label.
export type FrontOption = { capacity: number; name?: string };

// Everything a user can customize. Missing parts fall back to the defaults, so
// a null/empty layout behaves exactly like the built-in configuration.
export type SizeLayout = {
  grids?: Partial<Record<SizeSystem, GridLayout>>;
  fronts?: FrontOption[];
};

export const DEFAULT_FRONTS: FrontOption[] = [{ capacity: 6 }, { capacity: 8 }];
export const MAX_FRONT_CAPACITY = 30;

// Candidate tiles shown in the layout editor for each grid (defaults and any
// custom sizes are merged in).
export const SIZE_POOLS: Record<SizeSystem, string[]> = {
  letter: ["XXS", "XS", "S", "M", "L", "XL", "XXL"],
  small: ["23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "33", "34"],
  large: ["32", "34", "36", "38", "40", "42", "44", "46", "48"],
  "men-letter": ["XS", "S", "M", "L", "XL", "XXL", "XXXL"],
  "men-small": ["27", "28", "29", "30", "31", "32", "33", "34", "36", "38"],
  "men-large": ["42", "44", "46", "48", "50", "52", "54", "56", "58"],
  "men-shirt": ["37", "38", "39", "40", "41", "42", "43", "44", "45"],
};

export function defaultGridLayout(system: SizeSystem): GridLayout {
  const cfg = SIZE_CONFIGS[system] ?? SIZE_CONFIGS.letter;
  return { mandatory: [...cfg.mandatory], optional: [...cfg.optional] };
}

function cleanSizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    const size = String(raw ?? "").trim().toUpperCase();
    if (/^[A-Z0-9/.-]{1,8}$/.test(size) && !out.includes(size)) out.push(size);
  }
  return out.slice(0, 40);
}

// Validate/sanitize a stored or submitted layout. Invalid parts are dropped
// (fall back to defaults) rather than rejected, so a bad value can never break
// scanning. A grid override needs at least one mandatory size.
export function normalizeLayout(raw: unknown): SizeLayout {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const layout: SizeLayout = {};

  const gridsIn = (input.grids && typeof input.grids === "object"
    ? input.grids
    : {}) as Record<string, unknown>;
  const grids: Partial<Record<SizeSystem, GridLayout>> = {};
  for (const system of ALL_SIZE_SYSTEMS) {
    const g = gridsIn[system] as Record<string, unknown> | undefined;
    if (!g || typeof g !== "object") continue;
    const mandatory = cleanSizeList(g.mandatory);
    const optional = cleanSizeList(g.optional).filter((s) => !mandatory.includes(s));
    const custom = cleanSizeList(g.custom);
    if (mandatory.length === 0) continue;
    grids[system] = custom.length ? { mandatory, optional, custom } : { mandatory, optional };
  }
  if (Object.keys(grids).length) layout.grids = grids;

  if (Array.isArray(input.fronts)) {
    const fronts: FrontOption[] = [];
    for (const f of input.fronts as Array<Record<string, unknown>>) {
      const capacity = Math.floor(Number(f?.capacity));
      if (!Number.isFinite(capacity) || capacity < 1 || capacity > MAX_FRONT_CAPACITY) continue;
      if (fronts.some((x) => x.capacity === capacity)) continue;
      const name = String(f?.name ?? "").trim().slice(0, 24);
      fronts.push(name ? { capacity, name } : { capacity });
    }
    layout.fronts = fronts.sort((a, b) => a.capacity - b.capacity);
  }

  return layout;
}

export function frontsFor(layout?: SizeLayout | null): FrontOption[] {
  return layout?.fronts ?? DEFAULT_FRONTS;
}

// A front's own name, else "Front 10" (translated when `t` is given).
export function frontLabel(capacity: number, layout?: SizeLayout | null, t?: Translate): string {
  const named = frontsFor(layout).find((f) => f.capacity === capacity)?.name;
  return named || (t ? t("Front {capacity}", { capacity }) : `Front ${capacity}`);
}

function configFor(system: SizeSystem, layout?: SizeLayout | null): SizeConfig {
  const base = SIZE_CONFIGS[system] ?? SIZE_CONFIGS.letter;
  const override = layout?.grids?.[system];
  if (!override || override.mandatory.length === 0) {
    return base;
  }
  // Keep the built-in doubling preference for sizes that are still in the
  // grid, then any other mandatory sizes (e.g. custom ones) in grid order.
  const inGrid = [...override.mandatory, ...override.optional];
  const doublePref = base.doublePref.filter((s) => inGrid.includes(s));
  for (const size of orderSizes(override.mandatory)) {
    if (!doublePref.includes(size)) doublePref.push(size);
  }
  return {
    mandatory: override.mandatory,
    optional: override.optional.filter((s) => !override.mandatory.includes(s)),
    doublePref,
    priority: base.priority?.filter((s) => inGrid.includes(s)),
  };
}

// Backward-compatible aliases (women's systems keep their original names).
export const LETTER_SIZES = SIZE_CONFIGS.letter.mandatory;
export const SMALL_SIZES = SIZE_CONFIGS.small.mandatory;
export const LARGE_SIZES = SIZE_CONFIGS.large.mandatory;

export function baseSizesFor(system: SizeSystem, layout?: SizeLayout | null): string[] {
  return orderSizes(configFor(system, layout).mandatory);
}

export function optionalSizesFor(system: SizeSystem, layout?: SizeLayout | null): string[] {
  return orderSizes(configFor(system, layout).optional);
}

export function orderSizes(sizes: string[]): string[] {
  const unique = Array.from(new Set(sizes));
  if (unique.length > 0 && unique.every((s) => /^\d+$/.test(s))) {
    return unique.sort((a, b) => Number(a) - Number(b));
  }
  return unique.sort((a, b) => {
    const ia = LETTER_ORDER.indexOf(a);
    const ib = LETTER_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

// Sizes selectable in the hall (mandatory + optional), in display order.
export function selectableSizesFor(system: SizeSystem, layout?: SizeLayout | null): string[] {
  const cfg = configFor(system, layout);
  return orderSizes([...cfg.mandatory, ...cfg.optional]);
}

// Natural order of stored size keys: numbers (and jeans "29/32") numerically,
// letters by the XS..XL scale.
export function sortSizeKeys(keys: string[]): string[] {
  const numeric = keys.length > 0 && keys.every((key) => /^\d+(\/\d+)?$/.test(key));
  if (!numeric) return orderSizes(keys);
  return [...keys].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

// Display order for "need": the grid's priority sizes first, best first, then
// the rest in natural order. Grids without a priority keep the natural order.
export function prioritizeSizes(
  system: SizeSystem,
  sizes: string[],
  layout?: SizeLayout | null,
): string[] {
  const priority = configFor(system, layout).priority ?? [];
  const rank = (size: string) => {
    const index = priority.indexOf(splitSizeLength(size).base);
    return index < 0 ? priority.length : index;
  };
  return sortSizeKeys(sizes).sort((a, b) => rank(a) - rank(b));
}

// --- Men's jeans length (optional sub-size: 29/30, 29/32) --------------------

// Length is chosen per item: an item's sizes are all one length, and a product
// that hangs in both lengths is added as two items. Stored inside the size keys
// ("29/32"), so history, warehouse and PDF show it with no extra field.
export const JEANS_LENGTHS = [30, 32];

export function supportsLength(system: SizeSystem): boolean {
  return system === "men-small";
}

export function splitSizeLength(size: string): { base: string; length: number | null } {
  const match = size.match(/^(\d+)\/(\d+)$/);
  if (!match || !JEANS_LENGTHS.includes(Number(match[2]))) {
    return { base: size, length: null };
  }
  return { base: match[1], length: Number(match[2]) };
}

export function withLength(size: string, length: number | null | undefined): string {
  return length ? `${size}/${length}` : size;
}

export function applyLength(map: SizeQtyMap, length: number | null | undefined): SizeQtyMap {
  return Object.fromEntries(
    Object.entries(map).map(([size, qty]) => [withLength(size, length), qty]),
  );
}

// Back to plain sizes; merges duplicates so a bad key can never lose a count.
export function stripLength(map: SizeQtyMap): SizeQtyMap {
  const result: SizeQtyMap = {};
  for (const [size, qty] of Object.entries(map)) {
    const { base } = splitSizeLength(size);
    result[base] = (result[base] ?? 0) + qty;
  }
  return result;
}

// The length stored in an item's size keys (present first, then need).
export function lengthOfSizes(...maps: Array<SizeQtyMap | null | undefined>): number | null {
  for (const map of maps) {
    for (const size of Object.keys(map ?? {})) {
      const { length } = splitSizeLength(size);
      if (length) return length;
    }
  }
  return null;
}

// --- Gender / category helpers ----------------------------------------------

export function genderOf(system: SizeSystem): Gender {
  return system.startsWith("men-") ? "men" : "women";
}

export function categoryOf(system: SizeSystem): SizeCategory {
  return system.replace("men-", "") as SizeCategory;
}

export function sizeSystemFromParts(
  gender: Gender,
  category: SizeCategory,
): SizeSystem {
  // Shirts exist only for men; fall back to letters on the women's side.
  if (gender === "women" && category === "shirt") {
    return "letter";
  }
  return (gender === "men" ? `men-${category}` : category) as SizeSystem;
}

// Department codes starting with 45 mark men's merchandise.
export function isMenSection(storageSection: string | null | undefined): boolean {
  return /^\s*45/.test(storageSection ?? "");
}

// Raw size token read from the label's EUR line (letter vs a number).
export type SizeDetection = { kind: "letter" } | { kind: "number"; value: number };

// Combine the label's EUR token (letters vs a numeric size) with the department
// (men's if it starts with 45) to pick the concrete size system.
export function resolveSizeSystem(
  detection: SizeDetection | null,
  storageSection: string | null | undefined,
): SizeSystem | null {
  if (!detection) return null;
  const men = isMenSection(storageSection);
  if (detection.kind === "letter") {
    return men ? "men-letter" : "letter";
  }
  const n = detection.value;
  if (men) {
    if (n >= 28 && n <= 34) return "men-small";
    if (n >= 38 && n <= 43) return "men-shirt";
    if (n >= 44 && n <= 54) return "men-large";
    return null;
  }
  if (n >= 24 && n <= 32) return "small";
  if (n >= 34 && n <= 44) return "large";
  return null;
}

// Target multiset (size -> required quantity) for an item.
// Regular item: one of each mandatory size. Front: a display rack that also
// includes the optional sizes, filled/trimmed to the front capacity (6 or 8),
// doubling the preferred sizes. Trimming keeps the priority sizes longest.
export function buildTargetSizes(
  system: SizeSystem,
  frontSize: number | null | undefined,
  layout?: SizeLayout | null,
): SizeQtyMap {
  const cfg = configFor(system, layout);
  const base = frontSize ? [...cfg.mandatory, ...cfg.optional] : cfg.mandatory;
  const target: SizeQtyMap = {};
  for (const size of base) {
    target[size] = 1;
  }
  if (!frontSize) {
    return target;
  }

  const ordered = orderSizes(base);
  let total = ordered.length;

  if (total > frontSize) {
    // Trim down to capacity (e.g. a front of 6). Without a priority: the largest
    // sizes go first. With one: optional sizes, then other sizes (largest
    // first), then the priority sizes from the least important.
    const priority = cfg.priority ?? [];
    const rest = [...ordered].reverse().filter((size) => !priority.includes(size));
    const order = [
      ...rest.filter((size) => priority.length > 0 && cfg.optional.includes(size)),
      ...rest.filter((size) => priority.length === 0 || !cfg.optional.includes(size)),
      ...priority.filter((size) => ordered.includes(size)).reverse(),
    ];
    for (const size of order) {
      if (total <= frontSize) break;
      delete target[size];
      total -= 1;
    }
    return target;
  }

  const pref = cfg.doublePref;
  let i = 0;
  while (total < frontSize && pref.length > 0) {
    const size = pref[i % pref.length];
    target[size] = (target[size] ?? 0) + 1;
    total += 1;
    i += 1;
  }
  return target;
}

// Total garments expected to hang (Y in the "X of Y" indicator).
export function targetTotal(targetSizes: SizeQtyMap): number {
  return Object.values(targetSizes).reduce((sum, qty) => sum + qty, 0);
}

// Total garments currently hanging (X in the "X of Y" indicator).
export function presentTotal(presentSizesQty: SizeQtyMap): number {
  return Object.values(presentSizesQty).reduce(
    (sum, qty) => sum + Math.max(0, Number(qty) || 0),
    0,
  );
}
