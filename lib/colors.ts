// Visual color choices for a scanned item. This is metadata the worker picks by
// hand - separate from the 3-digit `color` code parsed off the label. A choice
// is stored as either a known color `name` (e.g. "blue") or a `#rrggbb` hex
// picked from the spectrum, and resolved back to a swatch color + label here.

export type CommonColor = {
  name: string;
  label: string;
  hex: string;
};

// The quick-pick panel mirrors the 13 color families of the cos.com catalog
// filter (Beige, Blanc, Bleu, Gris, Jaune, Marron, Mauve, Noir, Orange, Rose,
// Rouge, Turquoise, Vert), with proper garment shades instead of the site's
// placeholder RGB values.
export const COMMON_COLORS: CommonColor[] = [
  { name: "white", label: "White", hex: "#FFFFFF" },
  { name: "black", label: "Black", hex: "#1A1A1A" },
  { name: "gray", label: "Gray", hex: "#B6B6B4" },
  { name: "beige", label: "Beige", hex: "#E3D5B8" },
  { name: "brown", label: "Brown", hex: "#2B1B17" },
  { name: "blue", label: "Blue", hex: "#151B54" },
  { name: "turquoise", label: "Turquoise", hex: "#4AC6C9" },
  { name: "green", label: "Green", hex: "#2F6B4F" },
  { name: "yellow", label: "Yellow", hex: "#FFE87C" },
  { name: "orange", label: "Orange", hex: "#E8762C" },
  { name: "red", label: "Red", hex: "#DC2626" },
  { name: "pink", label: "Pink", hex: "#FAAFBA" },
  { name: "mauve", label: "Mauve", hex: "#A47DAB" },
];

// Names no longer in the picker but stored on older items - keep resolving them.
const LEGACY_COLORS: CommonColor[] = [
  { name: "sky", label: "Sky", hex: "#3BB9FF" },
  { name: "cream", label: "Cream", hex: "#FFF8E1" },
  { name: "burgundy", label: "Burgundy", hex: "#7B1E2B" },
];

const COMMON_COLOR_BY_NAME = new Map(
  [...COMMON_COLORS, ...LEGACY_COLORS].map((color) => [color.name, color]),
);

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

// Color words printed on garment labels, mapped to a stored color value (a
// palette name or a hex for shades outside the quick-pick palette). Multi-word
// phrases come first so "OFF WHITE" wins over "WHITE".
const LABEL_COLOR_WORDS: Array<[string, string]> = [
  ["OFF WHITE", "white"],
  ["OFFWHITE", "white"],
  ["LIGHT BLUE", "turquoise"],
  ["SKY BLUE", "turquoise"],
  ["BABY BLUE", "turquoise"],
  ["TURQUOISE", "turquoise"],
  ["TEAL", "turquoise"],
  ["DARK BLUE", "blue"],
  ["LIGHT PINK", "pink"],
  ["DARK GREY", "gray"],
  ["DARK GRAY", "gray"],
  ["LIGHT GREY", "gray"],
  ["LIGHT GRAY", "gray"],
  ["IVORY", "white"],
  ["ECRU", "beige"],
  ["CREAM", "beige"],
  ["NAVY", "blue"],
  ["DENIM", "blue"],
  ["BLUE", "blue"],
  ["CHARCOAL", "gray"],
  ["ANTHRACITE", "gray"],
  ["GREY", "gray"],
  ["GRAY", "gray"],
  ["BLACK", "black"],
  ["WHITE", "white"],
  ["CHOCOLATE", "brown"],
  ["BROWN", "brown"],
  ["TAUPE", "beige"],
  ["CAMEL", "beige"],
  ["SAND", "beige"],
  ["TAN", "beige"],
  ["BEIGE", "beige"],
  ["BURGUNDY", "red"],
  ["BORDEAUX", "red"],
  ["WINE", "red"],
  ["MAROON", "red"],
  ["ROSE", "pink"],
  ["PINK", "pink"],
  ["MUSTARD", "yellow"],
  ["YELLOW", "yellow"],
  ["RED", "red"],
  ["KHAKI", "green"],
  ["OLIVE", "green"],
  ["GREEN", "green"],
  ["ORANGE", "orange"],
  ["LILAC", "mauve"],
  ["MAUVE", "mauve"],
  ["PURPLE", "mauve"],
  ["VIOLET", "mauve"],
];

/**
 * Find a color word in OCR'd label text (uppercase) and return the stored
 * color value for it, or null. Whole-word match so e.g. TAN never fires on
 * a word like STANDARD.
 */
export function colorFromLabelText(upperText: string): string | null {
  for (const [word, value] of LABEL_COLOR_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(upperText)) {
      return value;
    }
  }
  return null;
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
