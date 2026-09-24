import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getSessionUser,
  hashPassword,
  normalizeUsername,
  sessionCookie,
  signSession,
  validateCredentials,
  verifyPassword,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

// Account settings of the signed-in user only - there are no roles yet, so no
// route here can read or change another user's account.

type AccountRow = {
  id: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  passwordHash: string | null;
  googleId: string | null;
  createdAt: Date;
};

// Never expose the password hash - only whether a password exists.
function publicAccount(user: AccountRow) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    emailVerified: user.emailVerified,
    hasPassword: Boolean(user.passwordHash),
    hasGoogle: Boolean(user.googleId),
    createdAt: user.createdAt,
  };
}

export async function GET(request: Request) {
  const session = getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({ where: { id: session.uid } });
  if (!user) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  return NextResponse.json({ account: publicAccount(user) });
}

const patchSchema = z.object({
  username: z.string().optional(),
  email: z.string().trim().max(254).optional(),
  currentPassword: z.string().max(128).optional(),
  newPassword: z.string().optional(),
});

export async function PATCH(request: Request) {
  const session = getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const d = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: session.uid } });
  if (!user) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const data: {
    username?: string;
    email?: string;
    emailVerified?: boolean;
    passwordHash?: string;
  } = {};

  if (d.username !== undefined) {
    const username = normalizeUsername(d.username);
    if (username !== user.username) {
      // Same rules as sign-up (the password part is checked separately below).
      const invalid = validateCredentials(username, "placeholder-ok");
      if (invalid) {
        return NextResponse.json({ error: invalid }, { status: 400 });
      }
      const taken = await prisma.user.findUnique({ where: { username } });
      if (taken) {
        return NextResponse.json({ error: "Username already taken." }, { status: 409 });
      }
      data.username = username;
    }
  }

  if (d.email !== undefined) {
    const email = d.email.toLowerCase();
    if (email !== (user.email ?? "")) {
      if (!z.email().safeParse(email).success) {
        return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
      }
      const taken = await prisma.user.findUnique({ where: { email } });
      if (taken) {
        return NextResponse.json({ error: "This email is used by another account." }, { status: 409 });
      }
      data.email = email;
      // A typed email is unverified: Google sign-in will not link by it.
      data.emailVerified = false;
    }
  }

  if (d.newPassword !== undefined) {
    // Changing an existing password needs the current one; a Google-only
    // account (no password yet) can set its first password from the session.
    if (user.passwordHash) {
      if (!d.currentPassword || !verifyPassword(d.currentPassword, user.passwordHash)) {
        return NextResponse.json({ error: "Current password is wrong." }, { status: 403 });
      }
    }
    if (d.newPassword.length < 6 || d.newPassword.length > 128) {
      return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
    }
    data.passwordHash = hashPassword(d.newPassword);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ account: publicAccount(user) });
  }

  const updated = await prisma.user.update({ where: { id: user.id }, data });
  const res = NextResponse.json({ account: publicAccount(updated) });
  // The session cookie carries the username - re-issue it after a rename.
  if (data.username) {
    res.headers.set("Set-Cookie", sessionCookie(signSession(updated.id, updated.username)));
  }
  return res;
}
