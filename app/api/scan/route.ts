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
  season: z.string().trim().max(32).optional().default(""),
  storageSection: z.string().trim().max(32).optional().default(""),
  labelPhotoUrl: z
    .string()
    .max(5_000_000)
    .refine(isPhotoReference, "Photo must be a URL or image data URL")
    .optional()
    .default(""),
  presentSizesQty: z.record(z.string(), z.union([z.number(), z.string()])),
});

async function findProductByLabelArticle(article: string) {
  const exactProduct = await prisma.product.findUnique({
    where: { article },
    include: { sizeSystem: true },
  });

  if (exactProduct) {
    return exactProduct;
  }

  const products = await prisma.product.findMany({
    include: { sizeSystem: true },
  });
  const prefixMatches = products
    .filter(
      (product) =>
        article.startsWith(product.article) || product.article.startsWith(article),
    )
    .sort((a, b) => b.article.length - a.article.length);

  if (
    prefixMatches.length === 1 ||
    prefixMatches[0]?.article.length !== prefixMatches[1]?.article.length
  ) {
    return prefixMatches[0];
  }

  return null;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = scanSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const product = await findProductByLabelArticle(parsed.data.article);

  if (!product) {
    return NextResponse.json(
      { error: "Article was not found in catalog" },
      { status: 404 },
    );
  }

  const presentSizesQty = normalizeSizeQty(parsed.data.presentSizesQty);
  const orderedSizes = HALL_REQUIRED_SIZES;
  const targetQtyBySize = HALL_TARGET_QTY_BY_SIZE;
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
