import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enterStore, storeStateFor } from "@/lib/stores";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

const schema = z.object({ code: z.string().min(1).max(64) });

// Invite link: joins the store and makes it the user's current one.
export async function POST(request: Request) {
  const session = getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const store = await prisma.store.findUnique({
    where: { inviteCode: parsed.data.code },
    select: { id: true },
  });
  if (!store) {
    return NextResponse.json({ error: "This invite link is no longer valid." }, { status: 404 });
  }
  await enterStore(session.uid, store.id, { allowPicking: true });
  return NextResponse.json(await storeStateFor(session.uid));
}
