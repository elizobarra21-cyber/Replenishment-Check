import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { storeStateFor } from "@/lib/stores";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

export async function GET(request: Request) {
  const session = getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  return NextResponse.json(await storeStateFor(session.uid));
}

const schema = z.object({ defaultStoreId: z.string().min(1) });

// Change the default store without moving the user's current shift.
export async function PATCH(request: Request) {
  const session = getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const state = await storeStateFor(session.uid);
  const storeId = parsed.data.defaultStoreId;
  if (!state.canPickStore || !state.stores.some((store) => store.id === storeId)) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }
  await prisma.storeMember.upsert({
    where: { userId_storeId: { userId: session.uid, storeId } },
    update: {},
    create: { userId: session.uid, storeId },
  });
  await prisma.user.update({ where: { id: session.uid }, data: { defaultStoreId: storeId } });
  return NextResponse.json(await storeStateFor(session.uid));
}
