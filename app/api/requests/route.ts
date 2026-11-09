import { RequestStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { sweepExpiredLabelPhotos } from "@/lib/photo-cleanup";
import { prisma } from "@/lib/prisma";
import { activeStoreIdOf } from "@/lib/stores";

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
    where: { userId: session.uid, storeId: await activeStoreIdOf(session.uid) },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { items: true } },
      items: { select: { createdAt: true }, orderBy: { createdAt: "asc" }, take: 1 },
    },
    take: 50,
  });

  // A session starts with its first item: the request row is created when the
  // previous session finishes, so createdAt is really that session's end.
  const sessions = requests
    .map(({ items, ...rest }) => ({ ...rest, startedAt: items[0]?.createdAt ?? rest.createdAt }))
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

  return NextResponse.json({ requests: sessions });
}

export async function POST(request: Request) {
  const session = getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const storeId = await activeStoreIdOf(session.uid);

  // Reuse an empty draft: reopening a finished session leaves the empty one
  // behind, and it must not pile up on every Finish.
  const emptyDraft = await prisma.replenishmentRequest.findFirst({
    where: { userId: session.uid, storeId, status: RequestStatus.DRAFT, items: { none: {} } },
    orderBy: { createdAt: "desc" },
  });
  if (emptyDraft) {
    return NextResponse.json({ request: emptyDraft }, { status: 200 });
  }

  const replenishmentRequest = await prisma.replenishmentRequest.create({
    data: {
      createdBy: session.uname,
      userId: session.uid,
      storeId,
      status: RequestStatus.DRAFT,
    },
  });

  return NextResponse.json({ request: replenishmentRequest }, { status: 201 });
}
