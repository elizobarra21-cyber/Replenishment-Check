import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isNetworkAdmin, newInviteCode } from "@/lib/stores";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

// All stores: network administrators only.
export async function GET(request: Request) {
  const session = getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!(await isNetworkAdmin(session.uid))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const stores = await prisma.store.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, _count: { select: { members: true } } },
  });
  return NextResponse.json({ stores });
}

const createSchema = z.object({ name: z.string().trim().min(1).max(60) });

export async function POST(request: Request) {
  const session = getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!(await isNetworkAdmin(session.uid))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a store name." }, { status: 400 });
  }
  const existing = await prisma.store.findUnique({ where: { name: parsed.data.name } });
  if (existing) {
    return NextResponse.json({ error: "A store with this name already exists." }, { status: 409 });
  }
  const store = await prisma.store.create({
    data: { name: parsed.data.name, inviteCode: newInviteCode() },
    select: { id: true, name: true },
  });
  return NextResponse.json({ store }, { status: 201 });
}
