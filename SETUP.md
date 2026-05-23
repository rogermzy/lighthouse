# Lighthouse — Setup

The dashboard runs out of the box with seed data. To pull **real** Google Calendar and Gmail data, you need to register a Google OAuth client and put two keys into `backend/.env`. This page walks you through it.

> **Note:** This is a personal-use app. The Google OAuth client stays in your own Google Cloud project; nothing leaves your machine.

## 1. Create a Google Cloud project (5 min)

1. Open <https://console.cloud.google.com/>.
2. **Top bar → project picker → New Project.** Name it anything (e.g. `lighthouse`).

## 2. Enable the APIs

In the new project, open **APIs & Services → Library** and enable:

- **Google Calendar API**
- **Gmail API**

## 3. Configure the OAuth consent screen

**APIs & Services → OAuth consent screen.**

- **User type:** External.
- **App name:** Lighthouse (or whatever).
- **User support email** / **developer contact:** your address.
- **Scopes:** skip — they're requested at runtime.
- **Test users:** **add your own Google account.** Without this, Google will refuse to issue a token for you.

You can leave the app in "Testing" mode indefinitely for personal use.

## 4. Create the OAuth client

**APIs & Services → Credentials → Create credentials → OAuth client ID.**

- **Application type:** Web application.
- **Name:** Lighthouse local.
- **Authorized redirect URIs:** add exactly

  ```
  http://127.0.0.1:7373/auth/google/callback
  ```

  (If you change `PORT` in `.env`, the redirect URI has to match.)

Hit **Create.** Google shows you a Client ID and Client Secret — keep them.

## 5. Wire the keys into the app

```bash
cd backend
cp .env.example .env
```

Open `backend/.env` and paste the two values:

```
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
```

## 6. Anthropic API key (powers "Suggest from goals")

The suggest button runs a Claude Opus 4.7 agent that reads your goals tree, today's calendar, and recent completions before proposing three picks. Without an API key, the modal falls back to a deterministic local picker — still functional, just not as smart.

1. Open <https://console.anthropic.com>, go to **Settings → API Keys**, create one.
2. Paste it into `backend/.env`:

   ```
   ANTHROPIC_API_KEY=sk-ant-api03-...
   ```

3. Restart the server. The boot line should change from `agent: no ANTHROPIC_API_KEY` to `agent: ready (Claude Opus 4.7)`.

Per-click cost is well under a cent (a typical run is ~5K input + 500 output tokens).

## 7. Optional: ClickUp / Notion / Things 3

Each of these is independent. Skip any you don't use.

### ClickUp

1. ClickUp → **Apps → API Token** → copy the `pk_…` token.
2. Find your **Team ID**: open any task in the browser, the URL is `app.clickup.com/<TEAM_ID>/v/li/…`.
3. Find your **User ID**: hover the avatar → My Settings → the URL ends in `user/<USER_ID>`. Or `curl -H "Authorization: $TOKEN" https://api.clickup.com/api/v2/user`.
4. Paste into `backend/.env`:
   ```
   CLICKUP_API_TOKEN=pk_…
   CLICKUP_TEAM_ID=…
   CLICKUP_USER_ID=…
   ```

### Notion

1. Notion → **Settings → Integrations → New integration**. Internal type. Copy the secret.
2. Open your tasks database. **···** menu → **Connect to** → pick the integration. (Without this step, the API can't see the DB.)
3. Database ID is in the URL: `notion.so/<workspace>/<DATABASE_ID>?v=…` (32 hex chars).
4. Paste into `backend/.env`:
   ```
   NOTION_API_KEY=secret_…
   NOTION_TASKS_DB_ID=…
   ```

### Workflowy

1. Workflowy → **Settings → API** → generate an API key. (Beta feature; if you don't see it, log in to <https://beta.workflowy.com> first.)
2. Decide which node to scan. The connector pulls the **children** of one parent:
   - `inbox` (default) — Workflowy's inbox bullet.
   - `today` — the date-node for today.
   - A specific node id — find it in a node's URL: `workflowy.com/#/abc123def456` → id is `abc123def456`.
3. Paste into `backend/.env`:
   ```
   WORKFLOWY_API_KEY=wfy_…
   WORKFLOWY_PARENT_ID=inbox        # or "today", or a specific node id
   ```

Open children of the parent become Lighthouse tasks (lane: `ondeck`). Completed Workflowy items are filtered out at sync time. The full-export endpoint exists but isn't used here (it's rate-limited to 1 request/minute due to size); the per-parent endpoint is sufficient for a triage workflow.

### Things 3

No config — Mac-only. If Things 3 is installed and reachable via AppleScript, the connector auto-enables on next server boot. First sync may prompt the OS for Automation permission; click Allow.

## 8. Optional: set up the Gmail "Lighthouse" label

In Gmail, create a label called `Lighthouse` (or any name — set `GMAIL_TRIAGE_LABEL` in `.env` to override). Apply it to any messages you want to land in the brain dump. Starring isn't a trigger — labeling is the only signal, so the import stays intentional.

## 9. Connect

Start the server:

```bash
cd backend
npm start
```

You should see:

```
[lighthouse] google: configured but not connected — visit /auth/google to connect
```

Open <http://127.0.0.1:7373/auth/google> in your browser. Sign in, accept the scopes, and Google will redirect you back to the dashboard. From here on, the calendar widget shows your real day and the brain dump fills with `Lighthouse`-labeled messages.

The server stores your refresh token in `backend/.tokens.json` (gitignored, chmod 0600). Delete that file to disconnect.

## Re-consent (after adding scopes)

If you connected Google before a new scope was added (e.g., we wired Google **Tasks** in a later release), your stored token won't carry the new permission. The relevant connector will surface `403 Insufficient Permission` in the Settings page sync status.

Fix: visit `http://127.0.0.1:7373/auth/google` again. Google re-prompts; accept; the new token lands with all current scopes. Existing Calendar + Gmail sync keep working through the re-grant.

Current Google scopes: `calendar.events.readonly`, `gmail.readonly`, `tasks.readonly`.

## Troubleshooting

- **"Access blocked: Lighthouse has not completed the Google verification process"** — you didn't add your account as a Test User in step 3.
- **"redirect_uri_mismatch"** — the redirect URI in step 4 must match exactly; check trailing slashes and `127.0.0.1` vs `localhost`.
- **`/auth/google` returns 503** — `.env` is missing or empty; re-run step 5 and restart the server.
- **No Gmail messages appearing** — confirm the label name matches `GMAIL_TRIAGE_LABEL` (default `Lighthouse`) and that at least one message has the label applied.
