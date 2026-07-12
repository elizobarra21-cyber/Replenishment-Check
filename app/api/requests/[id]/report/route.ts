import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { mailerConfigured, sendReportEmail } from "@/lib/mailer";
import { buildTextPdf, type PdfLine } from "@/lib/pdf";
import { formatSizeQty, type SizeQtyMap } from "@/lib/replenishment";
import { prisma } from "@/lib/prisma";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

const REPORT_TO = process.env.REPORT_TO || "star00@list.ru";

function asMap(value: unknown): SizeQtyMap {
  return (value ?? {}) as SizeQtyMap;
}

function compareField(a: string | null, b: string | null) {
  return (a ?? "").localeCompare(b ?? "", "en", { numeric: true, sensitivity: "base" });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await context.params;
  const data = await prisma.replenishmentRequest.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!data) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  const items = [...data.items].sort(
    (a, b) =>
      compareField(a.storageSection, b.storageSection) ||
      compareField(a.season, b.season) ||
      compareField(a.article, b.article) ||
      compareField(a.color, b.color),
  );

  const taken = items.filter((i) => i.pickStatus === "taken").length;
  const absent = items.filter((i) => i.pickStatus === "absent").length;
  const pending = items.length - taken - absent;

  const lines: PdfLine[] = [
    { text: "Replenishment report", size: 18, bold: true },
    { text: `Date: ${data.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC` },
    { text: `User: ${data.createdBy}` },
    { text: `Session: ${data.id}` },
    { text: `Status: ${data.status}` },
    { text: "" },
    {
      text: `Items: ${items.length}   Taken: ${taken}   Absent: ${absent}   Pending: ${pending}`,
      bold: true,
    },
    { text: "" },
  ];

  let currentDept: string | null | undefined;
  for (const item of items) {
    if (item.storageSection !== currentDept) {
      currentDept = item.storageSection;
      const deptItems = items.filter((i) => i.storageSection === currentDept);
      lines.push({
        text: `Department ${item.storageSection?.trim() || "-"} (${deptItems.length})`,
        size: 13,
        bold: true,
      });
    }
    const status = item.pickStatus ? ` [${item.pickStatus}]` : "";
    const color = item.color ? ` color ${item.color}` : "";
    const season = item.season ? ` season ${item.season}` : "";
    const note = item.warehouseNote ? `  note: ${item.warehouseNote}` : "";
    lines.push({
      text: `  ${item.article}${color}${season}  present: ${formatSizeQty(
        asMap(item.presentSizesQty),
      )}  need: ${formatSizeQty(asMap(item.neededSizesQty))}${status}${note}`,
    });
  }

  const pdf = buildTextPdf(lines);
  const filename = `replenishment-${data.id.slice(0, 8)}.pdf`;

  if (!mailerConfigured()) {
    // PDF is ready but no email provider is chosen yet (product decision).
    return NextResponse.json({
      sent: false,
      reason: "email-not-configured",
      to: REPORT_TO,
      bytes: pdf.byteLength,
    });
  }

  try {
    await sendReportEmail({
      to: REPORT_TO,
      subject: `Replenishment report ${data.id.slice(0, 8)}`,
      text: `Replenishment report for session ${data.id} (${items.length} items).`,
      filename,
      pdf,
    });
    return NextResponse.json({ sent: true, to: REPORT_TO });
  } catch (error) {
    return NextResponse.json(
      { sent: false, reason: "send-failed", message: String(error) },
      { status: 502 },
    );
  }
}
