import { Hono } from "hono";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { readTokens, writeTokens, hasTokens, deleteTokens } from "./tokens.js";

/** Read scopes for Calendar, Gmail (labelled triage), and Tasks.
 *  Adding a scope here means existing tokens become "insufficient" — the user
 *  must re-visit /auth/google to re-grant. Sync runs that hit the new API
 *  before re-consent will surface a 403 in sync_state.last_error. */
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  // Full (not readonly) so write-back can PATCH task status when the user
  // marks something done in Lighthouse. Existing tokens granted only the
  // readonly scope will 403 — re-visit /auth/google to re-consent.
  "https://www.googleapis.com/auth/tasks",
];

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function hasGoogleTokens(): boolean {
  return hasTokens("google");
}

// Cached client + the config it was built against. Reused across connectors so
// the "tokens" refresh handler is attached exactly once — otherwise gcal + gmail
// each register their own listener and race on token-file writes.
let cachedClient: OAuth2Client | null = null;
let cachedConfigKey = "";

function configKey(): string {
  return `${process.env.GOOGLE_CLIENT_ID ?? ""}|${process.env.GOOGLE_CLIENT_SECRET ?? ""}|${redirectUri()}`;
}

/**
 * Returns an authenticated OAuth2 client ready to be passed to googleapis SDK
 * methods. Throws if not configured. The instance is cached across calls (and
 * rebuilt only when the underlying config changes), so the refresh-token
 * listener is attached exactly once.
 */
export function googleOAuthClient(): OAuth2Client {
  if (!isGoogleOAuthConfigured()) {
    throw new Error("Google OAuth not configured (set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in .env).");
  }

  const key = configKey();
  if (cachedClient && cachedConfigKey === key) {
    // Re-apply latest tokens in case the file was updated out-of-band
    // (e.g., after a fresh /auth/google/callback completed).
    const tokens = readTokens("google");
    if (tokens) cachedClient.setCredentials(tokens);
    return cachedClient;
  }

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri()
  );
  const tokens = readTokens("google");
  if (tokens) client.setCredentials(tokens);
  client.on("tokens", (newTokens) => {
    const merged = { ...(readTokens("google") ?? {}), ...newTokens };
    writeTokens("google", merged);
  });

  cachedClient = client;
  cachedConfigKey = key;
  return client;
}

/**
 * Drop the cached OAuth2 client so the next `googleOAuthClient()` call rebuilds
 * from scratch. Used after a disconnect so any in-memory credentials are gone.
 */
export function invalidateOAuthCache(): void {
  cachedClient = null;
  cachedConfigKey = "";
}

function redirectUri(): string {
  const port = process.env.PORT ?? "7373";
  return process.env.GOOGLE_REDIRECT_URI ?? `http://127.0.0.1:${port}/auth/google/callback`;
}

export const authRouter = new Hono();

authRouter.get("/google", (c) => {
  if (!isGoogleOAuthConfigured()) {
    return c.text(
      "Google OAuth is not configured. Copy backend/.env.example to backend/.env and fill in GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET. See SETUP.md.",
      503
    );
  }
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri()
  );
  const url = client.generateAuthUrl({
    access_type: "offline", // request refresh_token
    prompt: "consent",      // always re-issue refresh_token so we don't lose it
    scope: SCOPES,
  });
  return c.redirect(url);
});

authRouter.get("/google/callback", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.text("Missing ?code in callback URL.", 400);
  if (!isGoogleOAuthConfigured()) return c.text("Google OAuth not configured.", 503);

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri()
  );
  try {
    const { tokens } = await client.getToken(code);
    writeTokens("google", tokens as Record<string, unknown>);
  } catch (err) {
    return c.text(`Token exchange failed: ${String(err)}`, 500);
  }
  return c.redirect("/");
});

authRouter.get("/status", (c) => {
  return c.json({
    google: {
      configured: isGoogleOAuthConfigured(),
      connected: hasGoogleTokens(),
    },
  });
});

// Disconnect — clears the stored Google refresh/access token and invalidates
// the cached OAuth2 client. Doesn't touch the OAuth client credentials in
// .env/settings; user can reconnect via /auth/google without re-entering keys.
authRouter.delete("/google", (c) => {
  deleteTokens("google");
  invalidateOAuthCache();
  return c.json({ ok: true, connected: false });
});
