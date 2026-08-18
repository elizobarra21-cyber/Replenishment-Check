import { RequestStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Label photos live in the DB only while they are useful: during the session
// (warehouse walk) plus a 1-day grace period after "Finish replenishment".
// After that the photo blobs are cleared; the rest of the item (sizes, notes,
// department, ...) stays for the history and PDF reports.
const PHOTO_RETENTION_MS = 24 * 60 * 60 * 1000;

// The sweep is opportunistic (no cron on this deployment): it piggybacks on
// regular API traffic, at most once per hour per server instance.
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

let lastSweepAt = 0;

export async function cleanupExpiredLabelPhotos(): Promise<number> {
  const cutoff = new Date(Date.now() - PHOTO_RETENTION_MS);
  const result = await prisma.requestItem.updateMany({
    where: {
      labelPhotoUrl: { not: null },
      request: { status: RequestStatus.DONE, updatedAt: { lt: cutoff } },
    },
    data: { labelPhotoUrl: null },
  });
  return result.count;
}

// Throttled entry point for API routes. Awaited (not fire-and-forget): the
// Supabase pooled connection string allows 1 connection per instance, so a
// concurrent background query would fight the route's own queries for it.
export async function sweepExpiredLabelPhotos(): Promise<void> {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) {
    return;
  }
  lastSweepAt = now;
  try {
    await cleanupExpiredLabelPhotos();
  } catch {
    lastSweepAt = 0; // failed (e.g. transient DB error) - allow the next request to retry
  }
}
