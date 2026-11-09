import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import {
  applyLength,
  buildSubstitutePriority,
  buildTargetSizes,
  computeNeededSizes,
  lengthOfSizes,
  MAX_FRONT_CAPACITY,
  normalizeSizeQty,
  stripLength,
  supportsLength,
  targetTotal,
  type SizeQtyMap,
  type SizeSystem,
} from "@/lib/replenishment";
import { prisma } from "@/lib/prisma";
import { loadStoreLayout, requestAccess } from "@/lib/stores";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

const updateItemSchema = z.object({
  pickStatus: z.enum(["taken", "absent"]).nullable().optional(),
  article: z.string().trim().min(1).max(32).optional(),
  color: z.string().trim().max(32).optional(),
  colorName: z.string().trim().max(32).optional(),
  season: z.string().trim().max(32).optional(),
  storageSection: z.string().trim().max(32).optional(),
  warehouseNote: z.string().trim().max(500).optional(),
  sizeSystem: z
    .enum(["letter", "small", "large", "men-letter", "men-small", "men-large", "men-shirt"])
    .optional(),
  frontSize: z.number().int().min(1).max(MAX_FRONT_CAPACITY).nullable().optional(),
  presentSizesQty: z
    .record(z.string(), z.union([z.number(), z.string()]))
    .optional(),
  sizeLength: z.union([z.literal(30), z.literal(32)]).nullable().optional(),
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
  const parsed = updateItemSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.requestItem.findUnique({
    where: { id },
    include: { product: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  const access = await requestAccess(session, existing.requestId);
  if (!access?.canWrite) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  const d = parsed.data;
  const data: Prisma.RequestItemUpdateInput = {};

  if (d.pickStatus !== undefined) data.pickStatus = d.pickStatus;
  if (d.color !== undefined) data.color = d.color || null;
  if (d.colorName !== undefined) data.colorName = d.colorName || null;
  if (d.season !== undefined) data.season = d.season || null;
  if (d.storageSection !== undefined) data.storageSection = d.storageSection || null;
  if (d.warehouseNote !== undefined) data.warehouseNote = d.warehouseNote || null;
  if (d.sizeSystem !== undefined) data.sizeSystem = d.sizeSystem;
  if (d.frontSize !== undefined) data.frontSize = d.frontSize;

  // Article change: re-point to a Product for the new article, reusing the
  // current product's section/size system (no merchandise catalog here).
  if (d.article !== undefined && d.article !== existing.article) {
    const product = await prisma.product.upsert({
      where: { article: d.article },
      update: {},
      create: {
        article: d.article,
        name: `Scanned article ${d.article}`,
        sectionId: existing.product.sectionId,
        sizeSystemId: existing.product.sizeSystemId,
      },
    });
    data.article = d.article;
    data.product = { connect: { id: product.id } };
  }

  // Recompute needed/substitute when present sizes or the size target changed.
  if (
    d.presentSizesQty !== undefined ||
    d.sizeSystem !== undefined ||
    d.frontSize !== undefined ||
    d.sizeLength !== undefined
  ) {
    const storedPresent = (existing.presentSizesQty as SizeQtyMap) ?? {};
    const storedNeeded = (existing.neededSizesQty as SizeQtyMap) ?? {};
    const present = stripLength(
      d.presentSizesQty !== undefined ? normalizeSizeQty(d.presentSizesQty) : storedPresent,
    );
    const system = (d.sizeSystem ?? existing.sizeSystem ?? "letter") as SizeSystem;
    const front = d.frontSize !== undefined ? d.frontSize : existing.frontSize;
    const layout = await loadStoreLayout(access.storeId);
    const target = buildTargetSizes(system, front ?? null, layout);
    const orderedSizes = Object.keys(target);

    // Men's jeans length lives in the stored size keys ("29/32").
    const requestedLength =
      d.sizeLength !== undefined ? d.sizeLength : lengthOfSizes(storedPresent, storedNeeded);
    const length = supportsLength(system) ? requestedLength : null;

    data.targetTotal = targetTotal(target);
    data.presentSizesQty = applyLength(present, length);
    data.neededSizesQty = applyLength(computeNeededSizes(orderedSizes, target, present), length);
    data.substitutePriority = buildSubstitutePriority(orderedSizes, present);
  }

  const updated = await prisma.requestItem.update({
    where: { id },
    data,
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

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await context.params;
  const existing = await prisma.requestItem.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  const access = await requestAccess(session, existing.requestId);
  if (!access?.canWrite) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  await prisma.requestItem.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
