import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildSubstitutePriority,
  computeNeededSizes,
  HALL_REQUIRED_SIZES,
  HALL_TARGET_QTY_BY_SIZE,
  normalizeSizeQty,
} from "@/lib/replenishment";
import { prisma } from "@/lib/prisma";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

function isPhotoReference(value: string) {
  if (value === "") {
    return true;
  }

  if (value.startsWith("data:image/")) {
    return true;
  }

  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

const scanSchema = z.object({
  requestId: z.string().min(1),
  article: z.string().min(1),
  color: z.string().trim().max(32).optional().default(""),
  colorName: z.string().trim().max(32).optional().default(""),
  season: z.string().trim().max(32).optional().default(""),
  storageSection: z.string().trim().max(32).optional().default(""),
  labelPhotoUrl: z
    .string()
    .max(5_000_000)
    .refine(isPhotoReference, "Photo must be a URL or image data URL")
    .optional()
    .default(""),
  presentSizesQty: z.record(z.string(), z.union([z.number(), z.string()])),
  orderedSizes: z.array(z.string()).optional(),
});

async function ensureHallSizeSystem() {
  return prisma.sizeSystem.upsert({
    where: { code: "HALL_XS_XL" },
    update: {
      orderedSizes: HALL_REQUIRED_SIZES,
      targetQtyBySize: HALL_TARGET_QTY_BY_SIZE,
      minDisplayItemCount: HALL_REQUIRED_SIZES.length,
    },
    create: {
      code: "HALL_XS_XL",
      name: "Hall sizes XS-XL",
      orderedSizes: HALL_REQUIRED_SIZES,
      targetQtyBySize: HALL_TARGET_QTY_BY_SIZE,
      minDisplayItemCount: HALL_REQUIRED_SIZES.length,
    },
  });
}

async function ensureScannedItemsSection() {
  return prisma.section.upsert({
    where: { name: "Scanned items" },
    update: { warehouseOrder: 9999 },
    create: {
      name: "Scanned items",
      warehouseOrder: 9999,
    },
  });
}

async function getOrCreateScannedProduct(article: string) {
  const [section, sizeSystem] = await Promise.all([
    ensureScannedItemsSection(),
    ensureHallSizeSystem(),
  ]);

  return prisma.product.upsert({
    where: { article },
    update: {
      name: `Scanned article ${article}`,
      sectionId: section.id,
      sizeSystemId: sizeSystem.id,
    },
    create: {
      article,
      name: `Scanned article ${article}`,
      sectionId: section.id,
      sizeSystemId: sizeSystem.id,
    },
    include: {
      section: true,
      sizeSystem: true,
    },
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = scanSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const product = await getOrCreateScannedProduct(parsed.data.article);

  const presentSizesQty = normalizeSizeQty(parsed.data.presentSizesQty);
  // Letter sizes (XS..XL) by default, or the numeric run (34..42) detected from
  // the label. The target is one of each size in the chosen system.
  const orderedSizes = parsed.data.orderedSizes?.length
    ? parsed.data.orderedSizes
    : HALL_REQUIRED_SIZES;
  const targetQtyBySize = Object.fromEntries(orderedSizes.map((size) => [size, 1]));
  const neededSizesQty = computeNeededSizes(
    orderedSizes,
    targetQtyBySize,
    presentSizesQty,
  );
  const substitutePriority = buildSubstitutePriority(orderedSizes, presentSizesQty);

  const requestItem = await prisma.requestItem.create({
    data: {
      requestId: parsed.data.requestId,
      productId: product.id,
      article: parsed.data.article,
      color: parsed.data.color || null,
      colorName: parsed.data.colorName || null,
      season: parsed.data.season || null,
      storageSection: parsed.data.storageSection || null,
      labelPhotoUrl: parsed.data.labelPhotoUrl || null,
      presentSizesQty,
      neededSizesQty,
      substitutePriority,
    },
    include: {
      product: {
        include: {
          section: true,
          sizeSystem: true,
        },
      },
    },
  });

  return NextResponse.json({
    item: requestItem,
    hints: {
      neededSizesQty,
      substitutePriority,
      orderedSizes,
      targetQtyBySize,
    },
  });
}
