import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { enterStore, storeStateFor } from "@/lib/stores";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

const schema = z.object({ storeId: z.string().min(1), makeDefault: z.boolean().optional() });

// Choose the store the user works in now (first choice or a shift elsewhere).
export async function POST(request: Request) {
  const session = getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const state = await storeStateFor(session.uid);
  if (!state.canPickStore || !state.stores.some((store) => store.id === parsed.data.storeId)) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }
  await enterStore(session.uid, parsed.data.storeId, { makeDefault: parsed.data.makeDefault });
  return NextResponse.json(await storeStateFor(session.uid));
}
