import { NextResponse } from "next/server";
import { z } from "zod";
import {
  normalizeUsername,
  sessionCookie,
  signSession,
  verifyPassword,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

const schema = z.object({
  username: z.string(),
  password: z.string(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const username = normalizeUsername(parsed.data.username);
  const user = await prisma.user.findUnique({ where: { username } });
  // Same response whether the user is missing, Google-only, or the password is wrong.
  if (!user?.passwordHash || !verifyPassword(parsed.data.password, user.passwordHash)) {
    return NextResponse.json({ error: "Wrong username or password." }, { status: 401 });
  }

  const res = NextResponse.json({ user: { id: user.id, username: user.username } });
  res.headers.set("Set-Cookie", sessionCookie(signSession(user.id, user.username)));
  return res;
}
