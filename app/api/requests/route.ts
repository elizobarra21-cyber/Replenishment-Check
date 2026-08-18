import { RequestStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { sweepExpiredLabelPhotos } from "@/lib/photo-cleanup";
import { prisma } from "@/lib/prisma";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

// List the signed-in user's own sessions (most recent first).
export async function GET(request: Request) {
  const session = getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // The session list loads on every sign-in / finish, which makes it a good
  // place to clear label photos of sessions finished more than a day ago.
  await sweepExpiredLabelPhotos();

  const requests = await prisma.replenishmentRequest.findMany({
    where: { userId: session.uid },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { items: true } } },
    take: 50,
  });

  return NextResponse.json({ requests });
}

export async function POST(request: Request) {
  const session = getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const replenishmentRequest = await prisma.replenishmentRequest.create({
    data: {
      createdBy: session.uname,
      userId: session.uid,
      status: RequestStatus.DRAFT,
    },
  });

  return NextResponse.json({ request: replenishmentRequest }, { status: 201 });
}
