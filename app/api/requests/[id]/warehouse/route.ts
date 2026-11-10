import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requestAccess } from "@/lib/stores";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

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

// Women's departments (23xx) come first, then men's (45xx), then the rest.
function genderRank(storageSection: string | null | undefined) {
  const normalized = storageSection?.trim() ?? "";
  if (/^23/.test(normalized)) return 0;
  if (/^45/.test(normalized)) return 1;
  return 2;
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
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!(await requestAccess(session, id))) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

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
    const genderDelta = genderRank(a.storageSection) - genderRank(b.storageSection);
    if (genderDelta !== 0) {
      return genderDelta;
    }

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
    sortOrder: ["gender(men-first)", "storageSection", "article", "color"],
  });
}
