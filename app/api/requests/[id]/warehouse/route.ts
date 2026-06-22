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

function storageOrder(storageSection: string | null | undefined) {
  const order = Number(storageSection);
  return Number.isInteger(order) && order > 0 ? order : 9999;
}

function storageGroupId(storageSection: string | null | undefined) {
  const normalized = storageSection?.trim();
  return normalized ? `storage-${normalized}` : "storage-unassigned";
}

function storageGroupName(storageSection: string | null | undefined) {
  const normalized = storageSection?.trim();
  return normalized ? `Department ${normalized}` : "No department";
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
    const sectionDelta = storageOrder(a.storageSection) - storageOrder(b.storageSection);
    if (sectionDelta !== 0) {
      return sectionDelta;
    }

    const storageDelta = compareLabelField(a.storageSection, b.storageSection);
    if (storageDelta !== 0) {
      return storageDelta;
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
    const sectionId = storageGroupId(item.storageSection);
    const existing = acc.find((entry) => entry.sectionId === sectionId);
    if (existing) {
      existing.items.push(item);
      return acc;
    }

    acc.push({
      sectionId,
      sectionName: storageGroupName(item.storageSection),
      warehouseOrder: storageOrder(item.storageSection),
      items: [item],
    });

    return acc;
  }, []);

  return NextResponse.json({
    request: requestData,
    grouped,
    sortOrder: ["storageSection", "article", "season", "color"],
  });
}
