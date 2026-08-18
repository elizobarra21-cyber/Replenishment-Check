import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { mailerConfigured, sendReportEmail } from "@/lib/mailer";
import { buildRequestReportPdf, reportFilename } from "@/lib/report";
import { prisma } from "@/lib/prisma";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

const REPORT_TO = process.env.REPORT_TO || "star00@list.ru";

async function loadRequestWithItems(id: string) {
  return prisma.replenishmentRequest.findUnique({
    where: { id },
    include: { items: true },
  });
}

// Download the session report as a PDF file (saved to the phone by the browser).
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await context.params;
  const data = await loadRequestWithItems(id);
  if (!data) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  const pdf = await buildRequestReportPdf(data);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${reportFilename(data)}"`,
      "Cache-Control": "no-store",
    },
  });
}

// Email the same PDF to the report inbox.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await context.params;
  const data = await loadRequestWithItems(id);
  if (!data) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  const pdf = await buildRequestReportPdf(data);

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
      text: `Replenishment report for session ${data.id} (${data.items.length} items).`,
      filename: reportFilename(data),
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
