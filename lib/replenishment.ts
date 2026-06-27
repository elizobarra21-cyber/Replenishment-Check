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

export type SizeSystem = "letter" | "small" | "large";

export const LETTER_SIZES = ["XS", "S", "M", "L", "XL"];
export const SMALL_SIZES = ["25", "26", "27", "28", "29", "30", "31"];
export const LARGE_SIZES = ["34", "36", "38", "40", "42"];
export const SMALL_OPTIONAL_SIZES = ["24", "32"]; // only if in stock
export const LARGE_OPTIONAL_SIZES = ["44"]; // optional unless the item is a front

export function baseSizesFor(system: SizeSystem): string[] {
  if (system === "small") return SMALL_SIZES;
  if (system === "large") return LARGE_SIZES;
  return LETTER_SIZES;
}

// Sizes preferred for doubling when filling a front to its capacity.
function doublePrefFor(system: SizeSystem): string[] {
  if (system === "letter") return ["S", "M", "L"];
  if (system === "large") return ["36", "38", "40", "42", "34", "44"];
  return SMALL_SIZES;
}

// Target multiset (size -> required quantity) for an item.
// Regular item: one of each base size. Front: filled/trimmed to the front
// capacity (6 or 8), doubling the preferred sizes (large fronts include 44).
export function buildTargetSizes(
  system: SizeSystem,
  frontSize: number | null | undefined,
): SizeQtyMap {
  const base = baseSizesFor(system);
  const target: SizeQtyMap = {};
  for (const size of base) {
    target[size] = 1;
  }
  if (frontSize && system === "large") {
    target["44"] = 1;
  }
  if (!frontSize) {
    return target;
  }

  let total = Object.values(target).reduce((sum, qty) => sum + qty, 0);

  if (total > frontSize) {
    // Trim down to capacity (e.g. small front of 6) by dropping the largest sizes.
    const order = [...base].reverse();
    let i = 0;
    while (total > frontSize && i < order.length * 4) {
      const size = order[i % order.length];
      if ((target[size] ?? 0) > 0) {
        target[size] -= 1;
        if (target[size] === 0) {
          delete target[size];
        }
        total -= 1;
      }
      i += 1;
    }
    return target;
  }

  const pref = doublePrefFor(system);
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
