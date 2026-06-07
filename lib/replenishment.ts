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
