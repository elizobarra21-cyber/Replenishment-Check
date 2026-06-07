import { RequestStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const createRequestSchema = z.object({
  createdBy: z.string().min(1).default("staff@telegram"),
});

export async function GET() {
  const requests = await prisma.replenishmentRequest.findMany({
    orderBy: { createdAt: "desc" },
    include: { items: true },
    take: 10,
  });

  return NextResponse.json({ requests });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = createRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const replenishmentRequest = await prisma.replenishmentRequest.create({
    data: {
      createdBy: parsed.data.createdBy,
      status: RequestStatus.DRAFT,
    },
  });

  return NextResponse.json({ request: replenishmentRequest }, { status: 201 });
}
