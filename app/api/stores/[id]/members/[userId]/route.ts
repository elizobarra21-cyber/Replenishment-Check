import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageStore } from "@/lib/stores";
import { msg } from "@/lib/i18n/core";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

type Context = { params: Promise<{ id: string; userId: string }> };

const schema = z.object({ role: z.enum(["MEMBER", "ADMIN"]) });

const LAST_ADMIN_ERROR = msg("A store needs at least one admin. Make someone else admin first.");

async function isLastAdmin(storeId: string, role: string): Promise<boolean> {
  if (role !== "ADMIN") return false;
  const admins = await prisma.storeMember.count({ where: { storeId, role: "ADMIN" } });
  return admins <= 1;
}

export async function PATCH(request: Request, context: Context) {
  const session = getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id, userId } = await context.params;
  if (!(await canManageStore(session.uid, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const member = await prisma.storeMember.findUnique({
    where: { userId_storeId: { userId, storeId: id } },
  });
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  if (parsed.data.role === "MEMBER" && (await isLastAdmin(id, member.role))) {
    return NextResponse.json({ error: LAST_ADMIN_ERROR }, { status: 409 });
  }
  await prisma.storeMember.update({
    where: { userId_storeId: { userId, storeId: id } },
    data: { role: parsed.data.role },
  });
  return NextResponse.json({ ok: true });
}

// Removing someone from their last store also takes away the store list, so
// they need a new invite link to come back.
export async function DELETE(request: Request, context: Context) {
  const session = getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id, userId } = await context.params;
  if (!(await canManageStore(session.uid, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const member = await prisma.storeMember.findUnique({
    where: { userId_storeId: { userId, storeId: id } },
  });
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  if (await isLastAdmin(id, member.role)) {
    return NextResponse.json({ error: LAST_ADMIN_ERROR }, { status: 409 });
  }
  await prisma.storeMember.delete({ where: { userId_storeId: { userId, storeId: id } } });
  await prisma.user.updateMany({ where: { id: userId, activeStoreId: id }, data: { activeStoreId: null } });
  await prisma.user.updateMany({ where: { id: userId, defaultStoreId: id }, data: { defaultStoreId: null } });
  const remaining = await prisma.storeMember.count({ where: { userId } });
  if (remaining === 0) {
    await prisma.user.update({ where: { id: userId }, data: { canPickStore: false } });
  }
  return NextResponse.json({ ok: true });
}
