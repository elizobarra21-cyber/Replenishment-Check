import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

export async function GET() {
  const sections = await prisma.section.findMany({ orderBy: { warehouseOrder: "asc" } });
  const sizeSystems = await prisma.sizeSystem.findMany({ orderBy: { name: "asc" } });

  return NextResponse.json({ sections, sizeSystems, products: [] });
}
