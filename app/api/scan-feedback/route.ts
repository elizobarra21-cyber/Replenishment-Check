import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

// Optional scan-quality feedback used to debug the OCR pipeline. Stores what
// the scanner read (ocr*) so misreads can be compared with the photo later.
const feedbackSchema = z.object({
  rating: z.enum(["good", "bad"]),
  ocrLine: z.string().trim().max(64).optional().default(""),
  article: z.string().trim().max(32).optional().default(""),
  color: z.string().trim().max(32).optional().default(""),
  season: z.string().trim().max(32).optional().default(""),
  storageSection: z.string().trim().max(32).optional().default(""),
  labelPhotoUrl: z.string().max(5_000_000).optional().default(""),
});

export async function POST(request: Request) {
  const session = getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = feedbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const d = parsed.data;
  const feedback = await prisma.scanFeedback.create({
    data: {
      rating: d.rating,
      ocrLine: d.ocrLine || null,
      article: d.article || null,
      color: d.color || null,
      season: d.season || null,
      storageSection: d.storageSection || null,
      labelPhotoUrl: d.labelPhotoUrl || null,
      userId: session.uid,
    },
  });

  return NextResponse.json({ ok: true, id: feedback.id });
}
