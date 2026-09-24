import { normalizeLayout, type SizeLayout } from "@/lib/replenishment";
import { prisma } from "@/lib/prisma";

// Server-only: the signed-in user's personal size layout (null = defaults).
// Always awaited by callers - the Supabase pooled connection has
// connection_limit=1, so it must not race the route's main query.
export async function loadUserLayout(userId: string | null | undefined): Promise<SizeLayout | null> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { layout: true },
  });
  return user?.layout ? normalizeLayout(user.layout) : null;
}
