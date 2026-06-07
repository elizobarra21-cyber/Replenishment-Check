import { NextResponse } from "next/server";
import { z } from "zod";
import { extractArticleFromLabel } from "@/lib/label-extractor";

const extractSchema = z.object({
	text: z.string().min(1),
	knownArticles: z.array(z.string()).optional().default([]),
	hintText: z.string().optional(),
	preferredDigits: z.number().int().min(1).max(16).optional(),
});

export async function POST(request: Request) {
	const body = await request.json().catch(() => ({}));
	const parsed = extractSchema.safeParse(body);

	if (!parsed.success) {
		return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
	}

	const result = extractArticleFromLabel(parsed.data.text, {
		knownArticles: parsed.data.knownArticles,
		hintText: parsed.data.hintText,
		preferredDigits: parsed.data.preferredDigits,
	});

	return NextResponse.json(result);
}
