import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isLang, translator } from "@/lib/i18n/core";
import { buildRequestReportPdf, reportFilename } from "@/lib/report";
import { prisma } from "@/lib/prisma";
import { requestAccess } from "@/lib/stores";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

// Download the session report as a PDF file (saved to the phone by the browser).
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!(await requestAccess(session, id))) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  const data = await prisma.replenishmentRequest.findUnique({
    where: { id },
    include: { items: true, store: { select: { layout: true } } },
  });
  if (!data) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  // Russian is the only non-English language the PDF font can print.
  const saved = /(?:^|;\s*)lang=(\w+)/.exec(request.headers.get("cookie") ?? "")?.[1];
  const pdf = await buildRequestReportPdf(data, translator(isLang(saved) && saved === "ru" ? "ru" : "en"));
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${reportFilename(data)}"`,
      "Cache-Control": "no-store",
    },
  });
}
