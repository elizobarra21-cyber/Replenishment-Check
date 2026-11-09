import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageStore } from "@/lib/stores";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

// Every employee's sessions in this store, for its administrators (read only).
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id } = await context.params;
  if (!(await canManageStore(session.uid, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const requests = await prisma.replenishmentRequest.findMany({
    where: { storeId: id, items: { some: {} } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      status: true,
      createdBy: true,
      createdAt: true,
      _count: { select: { items: true } },
      items: { select: { createdAt: true }, orderBy: { createdAt: "asc" }, take: 1 },
    },
  });
  const sessions = requests
    .map(({ items, ...rest }) => ({ ...rest, startedAt: items[0]?.createdAt ?? rest.createdAt }))
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  return NextResponse.json({ sessions });
}
