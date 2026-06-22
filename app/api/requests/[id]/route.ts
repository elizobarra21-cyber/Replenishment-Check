import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const requestData = await prisma.replenishmentRequest.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          product: {
            include: {
              section: true,
              sizeSystem: true,
            },
          },
        },
      },
    },
  });

  if (!requestData) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  return NextResponse.json({ request: requestData });
}

const updateRequestSchema = z.object({
  status: z.enum(["DRAFT", "SUBMITTED", "DONE"]),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const parsed = updateRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.replenishmentRequest.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  const updated = await prisma.replenishmentRequest.update({
    where: { id },
    data: { status: parsed.data.status },
  });

  return NextResponse.json({ request: updated });
}
