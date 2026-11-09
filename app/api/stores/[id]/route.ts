import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { normalizeLayout } from "@/lib/replenishment";
import { prisma } from "@/lib/prisma";
import { canManageStore, isNetworkAdmin, newInviteCode } from "@/lib/stores";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

async function loadStoreDetails(id: string) {
  return prisma.store.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      inviteCode: true,
      layout: true,
      layoutUpdatedAt: true,
      layoutUpdatedBy: true,
      members: {
        orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
        select: { userId: true, role: true, joinedAt: true, user: { select: { username: true } } },
      },
    },
  });
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
  if (!(await canManageStore(session.uid, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const store = await loadStoreDetails(id);
  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }
  return NextResponse.json({
    store: { ...store, layout: store.layout ? normalizeLayout(store.layout) : null },
  });
}

// Store rules (`layout`, null = defaults) and a new invite link: store
// administrators. Renaming: network administrators only.
export async function PATCH(
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
  const body = (await request.json().catch(() => null)) as {
    layout?: unknown;
    regenerateCode?: boolean;
    name?: unknown;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const data: Prisma.StoreUpdateInput = {};
  if ("layout" in body) {
    const layout = body.layout === null ? null : normalizeLayout(body.layout);
    const empty = !layout || (!layout.grids && !layout.fronts);
    data.layout = empty ? Prisma.DbNull : (layout as Prisma.InputJsonValue);
    data.layoutUpdatedAt = new Date();
    data.layoutUpdatedBy = session.uname;
  }
  if (body.regenerateCode) {
    data.inviteCode = newInviteCode();
  }
  if (typeof body.name === "string" && body.name.trim()) {
    if (!(await isNetworkAdmin(session.uid))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    data.name = body.name.trim().slice(0, 60);
  }

  await prisma.store.update({ where: { id }, data });
  const store = await loadStoreDetails(id);
  return NextResponse.json({
    store: store && { ...store, layout: store.layout ? normalizeLayout(store.layout) : null },
  });
}
