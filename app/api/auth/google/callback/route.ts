import { NextResponse } from "next/server";
import { sessionCookie, signSession } from "@/lib/auth";
import {
  appOrigin,
  clearOauthStateCookie,
  exchangeGoogleCode,
  readOauthState,
} from "@/lib/google-oauth";
import { prisma } from "@/lib/prisma";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

function failure(origin: string, reason: string) {
  const res = NextResponse.redirect(new URL(`/?authError=${reason}`, origin));
  res.headers.set("Set-Cookie", clearOauthStateCookie());
  return res;
}

// Finishes the Google sign-in flow: verifies `state`, exchanges the code for
// the Google profile, links or creates the local user, and sets the session.
export async function GET(request: Request) {
  const origin = appOrigin(request);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state || state !== readOauthState(request)) {
    return failure(origin, "google-denied");
  }

  const profile = await exchangeGoogleCode(code, `${origin}/api/auth/google/callback`);
  if (!profile) {
    return failure(origin, "google-failed");
  }

  // Match by Google id first, then link an existing account by email.
  let user = await prisma.user.findUnique({ where: { googleId: profile.sub } });
  if (!user && profile.email) {
    const byEmail = await prisma.user.findUnique({ where: { email: profile.email } });
    if (byEmail) {
      user = await prisma.user.update({
        where: { id: byEmail.id },
        data: { googleId: profile.sub },
      });
    }
  }

  if (!user) {
    const base = profile.email ?? `google-${profile.sub.slice(0, 12)}`;
    // Usernames are unique; suffix with part of the Google id on collision.
    const taken = await prisma.user.findUnique({ where: { username: base } });
    const username = taken ? `${base}-${profile.sub.slice(0, 6)}` : base;
    user = await prisma.user.create({
      data: {
        username,
        email: profile.email,
        googleId: profile.sub,
      },
    });
  }

  const res = NextResponse.redirect(new URL("/", origin));
  res.headers.append("Set-Cookie", sessionCookie(signSession(user.id, user.username)));
  res.headers.append("Set-Cookie", clearOauthStateCookie());
  return res;
}
