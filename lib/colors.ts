// Visual color choices for a scanned item. This is metadata the worker picks by
// hand - separate from the 3-digit `color` code parsed off the label. A choice
// is stored as either a known color `name` (e.g. "blue") or a `#rrggbb` hex
// picked from the spectrum, and resolved back to a swatch color + label here.

export type CommonColor = {
  name: string;
  label: string;
  hex: string;
};

// The most-used colors, shown as a quick-pick panel next to the color field.
export const COMMON_COLORS: CommonColor[] = [
  { name: "white", label: "White", hex: "#FFFFFF" },
  { name: "black", label: "Black", hex: "#1A1A1A" },
  { name: "gray", label: "Gray", hex: "#B6B6B4" },
  { name: "blue", label: "Blue", hex: "#151B54" },
  { name: "brown", label: "Brown", hex: "#2B1B17" },
  { name: "pink", label: "Pink", hex: "#FAAFBA" },
  { name: "yellow", label: "Yellow", hex: "#FFE87C" },
  { name: "sky", label: "Sky", hex: "#3BB9FF" },
  { name: "beige", label: "Beige", hex: "#E3D5B8" },
  { name: "cream", label: "Cream", hex: "#FFF8E1" },
  { name: "red", label: "Red", hex: "#DC2626" },
  { name: "burgundy", label: "Burgundy", hex: "#7B1E2B" },
];

const COMMON_COLOR_BY_NAME = new Map(COMMON_COLORS.map((color) => [color.name, color]));

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

/** Resolve a stored color value (known name or hex) to a swatch color + label. */
export function resolveColor(value: string | null | undefined): { hex: string; label: string } {
  const normalized = value?.trim() ?? "";
  const known = COMMON_COLOR_BY_NAME.get(normalized.toLowerCase());
  if (known) {
    return { hex: known.hex, label: known.label };
  }
  if (isHexColor(normalized)) {
    return { hex: normalized.toUpperCase(), label: normalized.toUpperCase() };
  }
  return { hex: "#CCCCCC", label: normalized || "-" };
}
