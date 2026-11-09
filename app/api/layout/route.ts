import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { activeStoreIdOf, loadStoreLayout } from "@/lib/stores";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

// The rules of the store the user works in now. `layout: null` means "built-in
// defaults" (the client computes those from lib/replenishment). Changed only by
// store administrators through PATCH /api/stores/[id].
export async function GET(request: Request) {
  const session = getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const storeId = await activeStoreIdOf(session.uid);
  return NextResponse.json({ layout: await loadStoreLayout(storeId) });
}
