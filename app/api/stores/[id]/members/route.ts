import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enterStore, isNetworkAdmin } from "@/lib/stores";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

type Context = { params: Promise<{ id: string }> };

const schema = z.object({ userId: z.string().min(1) });

// Add a person to this store, e.g. from the "without a store" list. Network
// administrators only; the person joins as an employee and may then pick
// stores like everyone who came by an invite link.
export async function POST(request: Request, context: Context) {
  const session = getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!(await isNetworkAdmin(session.uid))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const store = await prisma.store.findUnique({ where: { id }, select: { id: true } });
  const user = await prisma.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true } });
  if (!store || !user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await enterStore(user.id, store.id, { allowPicking: true });
  return NextResponse.json({ ok: true }, { status: 201 });
}
