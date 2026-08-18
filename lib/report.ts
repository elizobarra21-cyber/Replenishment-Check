// Shared builder for the session report PDF: used by the report route both to
// download the file (GET) and to email it (POST). Per-item fields mirror the
// scan history: department - article - color - present sizes - needed sizes -
// count in hall / target - note.

import type { ReplenishmentRequest, RequestItem } from "@prisma/client";
import { buildTextPdf, type PdfLine } from "@/lib/pdf";
import { resolveColor } from "@/lib/colors";
import {
  ALL_SIZE_SYSTEMS,
  buildTargetSizes,
  presentTotal,
  targetTotal,
  type SizeQtyMap,
  type SizeSystem,
} from "@/lib/replenishment";

export type RequestWithItems = ReplenishmentRequest & { items: RequestItem[] };

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

function itemTargetCount(item: RequestItem): number {
  return targetTotal(buildTargetSizes(itemSizeSystem(item), item.frontSize ?? null));
}

// "XS S M M L" - repeated tokens like the size tiles in the UI.
function sizeTokens(map: SizeQtyMap): string {
  const keys = Object.keys(map);
  const ordered =
    keys.length > 0 && keys.every((key) => /^\d+$/.test(key))
      ? keys.sort((a, b) => Number(a) - Number(b))
      : ["XS", "S", "M", "L", "XL", ...keys.filter((k) => !["XS", "S", "M", "L", "XL"].includes(k))];
  const tokens = ordered.flatMap((size) =>
    Array.from({ length: Math.max(0, Number(map[size]) || 0) }, () => size),
  );
  return tokens.length ? tokens.join(" ") : "-";
}

function compareField(a: string | null, b: string | null) {
  return (a ?? "").localeCompare(b ?? "", "en", { numeric: true, sensitivity: "base" });
}

// Same department order as the warehouse walk: men (45**) first, then women
// (23**), then the rest; inside a gender - by department number.
function genderRank(storageSection: string | null): number {
  const dept = (storageSection ?? "").trim();
  if (dept.startsWith("45")) return 0;
  if (dept.startsWith("23")) return 1;
  return 2;
}

export function reportFilename(data: RequestWithItems): string {
  const date = data.createdAt.toISOString().slice(0, 10);
  return `replenishment-${date}-${data.id.slice(0, 8)}.pdf`;
}

export async function buildRequestReportPdf(data: RequestWithItems): Promise<Uint8Array> {
  const items = [...data.items].sort(
    (a, b) =>
      genderRank(a.storageSection) - genderRank(b.storageSection) ||
      compareField(a.storageSection, b.storageSection) ||
      compareField(a.article, b.article) ||
      compareField(a.color, b.color),
  );

  const lines: PdfLine[] = [
    { text: "Replenishment report", size: 18, bold: true },
    { text: `Date: ${data.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC` },
    { text: `User: ${data.createdBy}` },
    { text: `Items: ${items.length}` },
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
        text: `Department ${currentDept?.trim() || "-"} (${deptItems.length})`,
        size: 13,
        bold: true,
      });
    }

    // One line per item: article - color - present - need - hall X/Y - note
    // (truncated with "..." if the line does not fit the page width).
    const present = asMap(item.presentSizesQty);
    const colorParts = [
      item.color ?? "",
      item.colorName ? `(${resolveColor(item.colorName).label})` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const chunks = [
      item.article,
      colorParts,
      `p: ${sizeTokens(present)}`,
      `n: ${sizeTokens(asMap(item.neededSizesQty))}`,
      `${presentTotal(present)}/${itemTargetCount(item)}`,
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
