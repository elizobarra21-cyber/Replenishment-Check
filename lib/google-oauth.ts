// Helpers shared by the Google OAuth start/callback routes. Server-only.

export const OAUTH_STATE_COOKIE = "sr_oauth_state";

/** Origin the OAuth redirect URI is built from. APP_URL wins (useful behind
 * proxies); otherwise the request's own origin is used. */
export function appOrigin(request: Request): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return new URL(request.url).origin;
}

/** Short-lived cookie holding the OAuth `state` value (CSRF protection). */
export function oauthStateCookie(state: string): string {
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  return `${OAUTH_STATE_COOKIE}=${state}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=600`;
}

export function clearOauthStateCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  return `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=0`;
}

/** Read the state cookie from a request. */
export function readOauthState(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${OAUTH_STATE_COOKIE}=`));
  return match ? match.slice(OAUTH_STATE_COOKIE.length + 1) : null;
}

export type GoogleProfile = {
  sub: string;
  email: string | null;
  name: string | null;
};

/** Exchange an authorization code for the user's Google profile. */
export async function exchangeGoogleCode(
  code: string,
  redirectUri: string,
): Promise<GoogleProfile | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return null;
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    return null;
  }

  const tokens = (await tokenRes.json()) as { id_token?: string };
  const idToken = tokens.id_token;
  if (!idToken) {
    return null;
  }

  // The id_token comes straight from Google over TLS, so decoding the payload
  // without re-verifying the signature is safe here.
  try {
    const payloadPart = idToken.split(".")[1] ?? "";
    const payload = JSON.parse(
      Buffer.from(payloadPart.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
    ) as { sub?: string; email?: string; name?: string };
    if (!payload.sub) {
      return null;
    }
    return {
      sub: payload.sub,
      email: payload.email?.toLowerCase() ?? null,
      name: payload.name ?? null,
    };
  } catch {
    return null;
  }
}
