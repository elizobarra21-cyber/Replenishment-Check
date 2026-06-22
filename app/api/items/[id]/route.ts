import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

const updateItemSchema = z.object({
  pickStatus: z.enum(["taken", "absent"]).nullable(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const parsed = updateItemSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.requestItem.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  const updated = await prisma.requestItem.update({
    where: { id },
    data: { pickStatus: parsed.data.pickStatus },
    include: {
      product: {
        include: {
          section: true,
          sizeSystem: true,
        },
      },
    },
  });

  return NextResponse.json({ item: updated });
}
