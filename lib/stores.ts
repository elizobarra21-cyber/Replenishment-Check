import { randomBytes } from "node:crypto";
import { normalizeLayout, type SizeLayout } from "@/lib/replenishment";
import type { SessionPayload } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Server-only: stores, permissions and the store's layout. Every check here runs
// on the server and is awaited one after another - the Supabase pooled
// connection has connection_limit=1, so queries must not race each other.

export function newInviteCode(): string {
  return randomBytes(9).toString("base64url");
}

export async function loadStoreLayout(storeId: string | null | undefined): Promise<SizeLayout | null> {
  if (!storeId) return null;
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { layout: true } });
  return store?.layout ? normalizeLayout(store.layout) : null;
}

export async function activeStoreIdOf(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { activeStoreId: true },
  });
  return user?.activeStoreId ?? null;
}

export async function isNetworkAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isNetworkAdmin: true },
  });
  return Boolean(user?.isNetworkAdmin);
}

// Store administrators and network administrators manage a store.
export async function canManageStore(userId: string, storeId: string): Promise<boolean> {
  if (await isNetworkAdmin(userId)) return true;
  const member = await prisma.storeMember.findUnique({
    where: { userId_storeId: { userId, storeId } },
    select: { role: true },
  });
  return member?.role === "ADMIN";
}

export type RequestAccess = {
  id: string;
  userId: string | null;
  storeId: string | null;
  canWrite: boolean;
};

// Who may touch a replenishment request: its owner reads and writes; the store's
// administrators read only. Null means "looks like it does not exist".
export async function requestAccess(
  session: SessionPayload,
  requestId: string,
): Promise<RequestAccess | null> {
  const found = await prisma.replenishmentRequest.findUnique({
    where: { id: requestId },
    select: { id: true, userId: true, storeId: true },
  });
  if (!found) return null;
  if (!found.userId || found.userId === session.uid) {
    return { ...found, canWrite: true };
  }
  if (found.storeId && (await canManageStore(session.uid, found.storeId))) {
    return { ...found, canWrite: false };
  }
  return null;
}

// Sessions made before stores existed join the user's first store.
async function adoptOldRequests(userId: string, storeId: string) {
  await prisma.replenishmentRequest.updateMany({
    where: { userId, storeId: null },
    data: { storeId },
  });
}

export async function storeStateFor(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      activeStoreId: true,
      defaultStoreId: true,
      canPickStore: true,
      isNetworkAdmin: true,
    },
  });
  const canPickStore = Boolean(user?.canPickStore || user?.isNetworkAdmin);
  const stores = await prisma.store.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const active = stores.find((store) => store.id === user?.activeStoreId) ?? null;
  const member = active
    ? await prisma.storeMember.findUnique({
        where: { userId_storeId: { userId, storeId: active.id } },
        select: { role: true },
      })
    : null;
  return {
    storesExist: stores.length > 0,
    needsStore: stores.length > 0 && !active,
    activeStore: active
      ? { ...active, canManage: Boolean(user?.isNetworkAdmin) || member?.role === "ADMIN" }
      : null,
    defaultStoreId: user?.defaultStoreId ?? null,
    canPickStore,
    isNetworkAdmin: Boolean(user?.isNetworkAdmin),
    // Only people who may switch see the store list.
    stores: canPickStore ? stores : [],
  };
}

// Put the user in a store. The first store also becomes their default and takes
// over their earlier sessions.
export async function enterStore(
  userId: string,
  storeId: string,
  options: { makeDefault?: boolean; allowPicking?: boolean } = {},
) {
  await prisma.storeMember.upsert({
    where: { userId_storeId: { userId, storeId } },
    update: {},
    create: { userId, storeId },
  });
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { defaultStoreId: true },
  });
  const firstStore = !user?.defaultStoreId;
  await prisma.user.update({
    where: { id: userId },
    data: {
      activeStoreId: storeId,
      ...(firstStore || options.makeDefault ? { defaultStoreId: storeId } : {}),
      ...(options.allowPicking ? { canPickStore: true } : {}),
    },
  });
  if (firstStore) {
    await adoptOldRequests(userId, storeId);
  }
}
