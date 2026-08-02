import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { appOrigin, oauthStateCookie } from "@/lib/google-oauth";

// Run this function in Frankfurt (fra1) - closest to the Supabase DB and to Israel.
export const preferredRegion = "fra1";

// Starts the Google sign-in flow: remembers a random `state` in a short-lived
// cookie and redirects to Google's consent screen.
export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(
      new URL("/?authError=google-not-configured", appOrigin(request)),
    );
  }

  const state = randomBytes(16).toString("hex");
  const origin = appOrigin(request);

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", `${origin}/api/auth/google/callback`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "select_account");

  const res = NextResponse.redirect(authUrl);
  res.headers.set("Set-Cookie", oauthStateCookie(state));
  return res;
}
