import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isNetworkAdmin } from "@/lib/stores";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

// People who belong to no store yet (new accounts without an invite, people
// removed from their last store, accounts that haven't picked one): network
// administrators only.
export async function GET(request: Request) {
  const session = getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!(await isNetworkAdmin(session.uid))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const users = await prisma.user.findMany({
    where: { memberships: { none: {} } },
    orderBy: { createdAt: "desc" },
    select: { id: true, username: true, createdAt: true },
  });
  return NextResponse.json({ users });
}
