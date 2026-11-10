// Shared builder for the session report PDF: used by the report route both to
// download the file (GET) and to email it (POST). Per-item fields mirror the
// scan history: department - product number - article - present sizes - needed
// sizes - count in hall / target - note. (DB fields: RequestItem.article is the
// product number, RequestItem.color is the article.)

import type { ReplenishmentRequest, RequestItem } from "@prisma/client";
import { buildTextPdf, type PdfLine } from "@/lib/pdf";
import { resolveColor } from "@/lib/colors";
import { translate, type Translate } from "@/lib/i18n/core";
import {
  ALL_SIZE_SYSTEMS,
  buildTargetSizes,
  presentTotal,
  normalizeLayout,
  prioritizeSizes,
  sortSizeKeys,
  targetTotal,
  type SizeLayout,
  type SizeQtyMap,
  type SizeSystem,
} from "@/lib/replenishment";

// `store.layout` (the store's grids/fronts) is optional: without it targets fall
// back to the built-in defaults.
export type RequestWithItems = ReplenishmentRequest & {
  items: RequestItem[];
  store?: { layout: unknown } | null;
};

function asMap(value: unknown): SizeQtyMap {
  return (value ?? {}) as SizeQtyMap;
}

// Same best-effort fallback as the client: older items may lack sizeSystem.
function itemSizeSystem(item: RequestItem): SizeSystem {
  if (item.sizeSystem && ALL_SIZE_SYSTEMS.includes(item.sizeSystem as SizeSystem)) {
    return item.sizeSystem as SizeSystem;
  }
  const keys = [
    ...Object.keys(asMap(item.presentSizesQty)),
    ...Object.keys(asMap(item.neededSizesQty)),
  ];
  if (keys.some((k) => /^\d+$/.test(k) && Number(k) >= 34)) return "large";
  if (keys.some((k) => /^\d+$/.test(k) && Number(k) >= 24 && Number(k) <= 33)) return "small";
  return "letter";
}

function itemTargetCount(item: RequestItem, layout: SizeLayout | null): number {
  return item.targetTotal ?? targetTotal(buildTargetSizes(itemSizeSystem(item), item.frontSize ?? null, layout));
}

// "XS S M M L" - repeated tokens like the size tiles in the UI.
function sizeTokens(map: SizeQtyMap, ordered: string[] = sortSizeKeys(Object.keys(map))): string {
  const tokens = ordered.flatMap((size) =>
    Array.from({ length: Math.max(0, Number(map[size]) || 0) }, () => size),
  );
  return tokens.length ? tokens.join(" ") : "-";
}

// When the session started: its first item. The request row itself is created
// when the previous session finishes, so its createdAt says nothing about this one.
function sessionStart(data: RequestWithItems): Date {
  const times = data.items.map((item) => item.createdAt.getTime());
  return times.length ? new Date(Math.min(...times)) : data.createdAt;
}

function compareField(a: string | null, b: string | null) {
  return (a ?? "").localeCompare(b ?? "", "en", { numeric: true, sensitivity: "base" });
}

// Same department order as the warehouse walk: women (23**) first, then men
// (45**), then the rest; inside a gender - by department number.
function genderRank(storageSection: string | null): number {
  const dept = (storageSection ?? "").trim();
  if (dept.startsWith("23")) return 0;
  if (dept.startsWith("45")) return 1;
  return 2;
}

export function reportFilename(data: RequestWithItems): string {
  const date = sessionStart(data).toISOString().slice(0, 10);
  return `replenishment-${date}-${data.id.slice(0, 8)}.pdf`;
}

// `t` translates the report's own words; the PDF font covers Latin and
// Cyrillic only, so Hebrew and Arabic readers get the English report.
export async function buildRequestReportPdf(
  data: RequestWithItems,
  t: Translate = (key, vars) => translate("en", key, vars),
): Promise<Uint8Array> {
  const layout = data.store?.layout ? normalizeLayout(data.store.layout) : null;
  const items = [...data.items].sort(
    (a, b) =>
      genderRank(a.storageSection) - genderRank(b.storageSection) ||
      compareField(a.storageSection, b.storageSection) ||
      compareField(a.article, b.article) ||
      compareField(a.color, b.color),
  );

  const lines: PdfLine[] = [
    { text: t("Replenishment report"), size: 18, bold: true },
    {
      text: t("Started: {time} UTC", {
        time: sessionStart(data).toISOString().slice(0, 16).replace("T", " "),
      }),
    },
    { text: t("User: {user}", { user: data.createdBy }) },
    { text: t("Items: {n}", { n: items.length }) },
    { text: "" },
  ];

  let currentDept: string | null | undefined;
  for (const item of items) {
    if (currentDept === undefined || item.storageSection !== currentDept) {
      if (currentDept !== undefined) {
        lines.push({ text: "", size: 5 });
      }
      currentDept = item.storageSection;
      const deptItems = items.filter((i) => i.storageSection === currentDept);
      lines.push({
        text: t("Department {dept} ({n})", { dept: currentDept?.trim() || "-", n: deptItems.length }),
        size: 13,
        bold: true,
      });
    }

    // One line per item: product number - article - present - need - hall X/Y - note
    // (truncated with "..." if the line does not fit the page width).
    const present = asMap(item.presentSizesQty);
    const needed = asMap(item.neededSizesQty);
    const colorParts = [
      item.color ?? "",
      item.colorName ? `(${t(resolveColor(item.colorName).label)})` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const chunks = [
      item.article,
      colorParts,
      `${t("p:")} ${sizeTokens(present)}`,
      `${t("n:")} ${sizeTokens(needed, prioritizeSizes(itemSizeSystem(item), Object.keys(needed), layout))}`,
      `${presentTotal(present)}/${itemTargetCount(item, layout)}`,
      item.warehouseNote ? `- ${item.warehouseNote}` : "",
    ].filter(Boolean);
    lines.push({
      text: chunks.join("  "),
      size: 10,
      indent: 12,
      truncate: true,
    });
  }

  return buildTextPdf(lines);
}
