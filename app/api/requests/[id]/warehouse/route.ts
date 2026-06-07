import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function compareLabelField(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  return (left ?? "").localeCompare(right ?? "", "en", {
    numeric: true,
    sensitivity: "base",
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const requestData = await prisma.replenishmentRequest.findUnique({
    where: { id },
    include: {
      items: {
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

  const sortedItems = [...requestData.items].sort((a, b) => {
    const sectionDelta =
      a.product.section.warehouseOrder - b.product.section.warehouseOrder;
    if (sectionDelta !== 0) {
      return sectionDelta;
    }

    const articleDelta = compareLabelField(a.article, b.article);
    if (articleDelta !== 0) {
      return articleDelta;
    }

    const seasonDelta = compareLabelField(a.season, b.season);
    if (seasonDelta !== 0) {
      return seasonDelta;
    }

    return compareLabelField(a.color, b.color);
  });

  const grouped = sortedItems.reduce<
    Array<{
      sectionId: string;
      sectionName: string;
      warehouseOrder: number;
      items: typeof sortedItems;
    }>
  >((acc, item) => {
    const existing = acc.find((entry) => entry.sectionId === item.product.section.id);
    if (existing) {
      existing.items.push(item);
      return acc;
    }

    acc.push({
      sectionId: item.product.section.id,
      sectionName: item.product.section.name,
      warehouseOrder: item.product.section.warehouseOrder,
      items: [item],
    });

    return acc;
  }, []);

  return NextResponse.json({
    request: requestData,
    grouped,
    sortOrder: ["warehouseOrder", "article", "season", "color"],
  });
}
