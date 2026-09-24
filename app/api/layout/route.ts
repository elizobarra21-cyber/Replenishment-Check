import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getSessionUser } from "@/lib/auth";
import { normalizeLayout } from "@/lib/replenishment";
import { prisma } from "@/lib/prisma";
import { loadUserLayout } from "@/lib/user-layout";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

// The signed-in user's personal size-grid/front layout. `layout: null` means
// "built-in defaults" (the client computes those from lib/replenishment).
export async function GET(request: Request) {
  const session = getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  return NextResponse.json({ layout: await loadUserLayout(session.uid) });
}

// Replace the whole layout (sanitized server-side); `{ layout: null }` resets
// everything to the defaults.
export async function PUT(request: Request) {
  const session = getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { layout?: unknown } | null;
  if (!body || !("layout" in body)) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const layout = body.layout === null ? null : normalizeLayout(body.layout);
  const empty = !layout || (!layout.grids && !layout.fronts);
  await prisma.user.update({
    where: { id: session.uid },
    data: { layout: empty ? Prisma.DbNull : (layout as Prisma.InputJsonValue) },
  });
  return NextResponse.json({ layout: empty ? null : layout });
}
