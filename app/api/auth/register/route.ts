import { NextResponse } from "next/server";
import { z } from "zod";
import {
  hashPassword,
  normalizeUsername,
  sessionCookie,
  signSession,
  validateCredentials,
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
  const password = parsed.data.password;
  const invalid = validateCredentials(username, password);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return NextResponse.json({ error: "Username already taken." }, { status: 409 });
  }

  const user = await prisma.user.create({
    data: { username, passwordHash: hashPassword(password) },
  });

  const res = NextResponse.json({ user: { id: user.id, username: user.username } });
  res.headers.set("Set-Cookie", sessionCookie(signSession(user.id, user.username)));
  return res;
}
