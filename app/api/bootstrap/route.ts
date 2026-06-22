import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const sections = await prisma.section.findMany({ orderBy: { warehouseOrder: "asc" } });
  const sizeSystems = await prisma.sizeSystem.findMany({ orderBy: { name: "asc" } });

  return NextResponse.json({ sections, sizeSystems, products: [] });
}
