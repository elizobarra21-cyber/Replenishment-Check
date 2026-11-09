import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { lengthOfSizes, type SizeQtyMap } from "@/lib/replenishment";
import { prisma } from "@/lib/prisma";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

const MAX_SUGGESTIONS = 5;

// The signed-in user's past descriptions of a product number, newest first and
// without repeats. Only ever the user's own items; photos are not loaded.
export async function GET(request: Request) {
  const session = getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const article = new URL(request.url).searchParams.get("article")?.trim() ?? "";
  if (!/^\d{5,10}$/.test(article)) {
    return NextResponse.json({ suggestions: [] });
  }

  const items = await prisma.requestItem.findMany({
    where: { article, request: { userId: session.uid } },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      createdAt: true,
      color: true,
      colorName: true,
      season: true,
      storageSection: true,
      sizeSystem: true,
      frontSize: true,
      warehouseNote: true,
      presentSizesQty: true,
      neededSizesQty: true,
    },
  });

  const seen = new Set<string>();
  const suggestions = [];
  for (const item of items) {
    if (!item.color && !item.colorName && !item.warehouseNote) continue;
    const key = [item.color, item.colorName, item.warehouseNote].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const { presentSizesQty, neededSizesQty, ...rest } = item;
    suggestions.push({
      ...rest,
      sizeLength: lengthOfSizes(presentSizesQty as SizeQtyMap, neededSizesQty as SizeQtyMap),
    });
    if (suggestions.length === MAX_SUGGESTIONS) break;
  }

  return NextResponse.json({ suggestions });
}
