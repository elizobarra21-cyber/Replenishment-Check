import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

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

  // Someone else's session looks the same as a missing one.
  if (!requestData || (requestData.userId && requestData.userId !== session.uid)) {
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
  const session = getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const parsed = updateRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.replenishmentRequest.findUnique({ where: { id } });
  if (!existing || (existing.userId && existing.userId !== session.uid)) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  const updated = await prisma.replenishmentRequest.update({
    where: { id },
    data: { status: parsed.data.status },
  });

  return NextResponse.json({ request: updated });
}
