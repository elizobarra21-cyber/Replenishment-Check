import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import {
  buildSubstitutePriority,
  buildTargetSizes,
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
  article: z.string().regex(/^\d{5,10}$/, "Article must be 5-10 digits"),
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
  // Required field: the hall worker must confirm the size grid explicitly
  // (or have it auto-detected from the label) before adding an item.
  sizeSystem: z.enum([
    "letter",
    "small",
    "large",
    "men-letter",
    "men-small",
    "men-large",
    "men-shirt",
  ]),
  frontSize: z.number().int().nullable().optional(),
  warehouseNote: z.string().trim().max(500).optional().default(""),
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
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = scanSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const presentSizesQty = normalizeSizeQty(parsed.data.presentSizesQty);
  // Required field: at least one size present in the hall (the scanned garment
  // itself hangs there, so an empty selection means the step was skipped).
  if (Object.keys(presentSizesQty).length === 0) {
    return NextResponse.json(
      { error: "Mark the sizes present in the hall before adding." },
      { status: 400 },
    );
  }

  const product = await getOrCreateScannedProduct(parsed.data.article);
  // Target multiset by size: from the size system + front (fronts double sizes
  // up to their capacity).
  const targetQtyBySize = buildTargetSizes(
    parsed.data.sizeSystem,
    parsed.data.frontSize ?? null,
  );
  const orderedSizes = Object.keys(targetQtyBySize);
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
      sizeSystem: parsed.data.sizeSystem ?? null,
      frontSize: parsed.data.frontSize ?? null,
      warehouseNote: parsed.data.warehouseNote || null,
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
