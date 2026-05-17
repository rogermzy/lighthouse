# Install

A runbook for an agent walking a user through a fresh Lighthouse install. Be interactive — ask for keys when you need them, run verify commands yourself, only walk through the connectors the user actually uses.

The whole install takes ~10 minutes if Google OAuth setup is the long pole.

---

## 0. Prereqs

```bash
node --version    # need ≥ 24 (uses node:sqlite, no native build step)
git --version
```

If Node < 24:
- Mac w/ Homebrew: `brew install node`
- Otherwise: `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && nvm install 24`

## 1. Install dependencies

```bash
cd backend && npm install
```

**Verify**: `ls node_modules/@anthropic-ai/sdk` exists.

## 2. Anthropic API key (drives Suggest + enrichment agents)

Ask: "Do you have an Anthropic API key, or skip for now? Without it, the suggest button falls back to a deterministic local picker — still works, just not as smart. Enrichment (theme + goal alignment + weight on each task) is disabled."

If yes, create `backend/.env`:
```
ANTHROPIC_API_KEY=sk-ant-api03-...
```

If no, skip — the server boots in fallback mode. Tell the user they can add the key later via the Settings page in the UI.

## 3. Google OAuth (Calendar + Gmail + Tasks)

The biggest section. Ask: "Connect Google Calendar, Gmail, and Tasks?" If no, skip the whole section.

### 3a. Create a Google Cloud project

Open <https://console.cloud.google.com/>. Top bar → project picker → **New Project**. Name it `lighthouse`.

### 3b. Enable APIs

In the new project → **APIs & Services → Library**. Enable all three:
- Google Calendar API
- Gmail API
- Tasks API

### 3c. OAuth consent screen

**APIs & Services → OAuth consent screen.**
- User type: **External**
- App name: `Lighthouse`
- User support email + developer contact: user's Gmail
- Scopes: skip (requested at runtime)
- Test users: **add the user's own Gmail address.** Without this, Google refuses to issue a token.

Leave the app in "Testing" mode indefinitely.

### 3d. Create OAuth client

**APIs & Services → Credentials → Create credentials → OAuth client ID.**
- Application type: **Web application**
- Name: `Lighthouse local`
- Authorized redirect URIs: exactly `http://127.0.0.1:3000/auth/google/callback`

Copy the Client ID and Client Secret.

Append to `backend/.env`:
```
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
```

### 3e. Boot the server

Start it in the background so you can keep running verify commands:

```bash
cd backend && npm start
```

Expect the boot line `[lighthouse] google: keys set, visit /auth/google to connect`.

### 3f. Complete OAuth

Tell the user: "Open `http://127.0.0.1:3000/auth/google` in your browser, sign in, and accept the scopes."

**Verify**:
```bash
curl -s http://127.0.0.1:3000/api/sync | jq '.syncs[] | select(.source=="gcal")'
```
`enabled` should be `true`. `lastError` may still be `null` until the first sync tick (≤ 60 seconds) — re-run if so.

## 4. Optional connectors

Ask once: **"Which of these do you use? ClickUp, Notion, Workflowy, flomo, Things 3?"** Skip every one they don't use.

### ClickUp

1. ClickUp → **Apps → API Token** → copy the `pk_…` token.
2. Team ID: open any task in the browser; URL is `app.clickup.com/<TEAM_ID>/v/li/...`.
3. User ID: easiest is `curl -H "Authorization: <pk_token>" https://api.clickup.com/api/v2/user | jq '.user.id'`.

Append to `backend/.env`:
```
CLICKUP_API_TOKEN=pk_…
CLICKUP_TEAM_ID=…
CLICKUP_USER_ID=…
```

**Verify** (after server restart, then 30 sec for first tick):
```bash
curl -s http://127.0.0.1:3000/api/sync | jq '.syncs[] | select(.source=="clickup")'
```
Expect `enabled: true`, `lastError: null`.

### Notion

1. Notion → **Settings → Integrations → New integration** (internal type). Copy the secret.
2. Open the user's tasks database. **···** menu → **Connect to** → pick the integration. **This step is mandatory** — without it the API returns `object_not_found`.
3. Database ID: from URL `notion.so/<workspace>/<DATABASE_ID>?v=…` — the 32-hex-char segment (ignore the `?v=` query param).

Append to `backend/.env`:
```
NOTION_API_KEY=secret_…
NOTION_TASKS_DB_ID=…
```

### Workflowy

1. <https://workflowy.com> → **Settings → API** → generate an API key. If not visible, the user needs to log in to <https://beta.workflowy.com> first (beta feature).
2. Decide which parent node to scan: `inbox` (default — Workflowy's inbox bullet), `today` (the date-node), or a specific node id (last segment of a node's share URL, e.g. `workflowy.com/#/abc123def456` → `abc123def456`).

Append to `backend/.env`:
```
WORKFLOWY_API_KEY=wfy_…
WORKFLOWY_PARENT_ID=inbox
```

### flomo

Two independent flows; either or both can be set:

- **RSS pull** (requires flomo PRO): flomo → settings → 私密 RSS → copy URL → `FLOMO_RSS_URL=...`
- **Webhook push** (free): flomo → settings → API & 集成 → 增量 API → copy URL → `FLOMO_WEBHOOK_URL=...`

Every journal entry written in Lighthouse is pushed to flomo tagged `#lighthouse`. The RSS pull skips anything with that tag so entries don't round-trip.

### Things 3

Mac-only, no config. If Things 3 is installed on the user's Mac, the connector auto-enables on next server boot. First sync triggers a macOS Automation permission prompt — user clicks Allow once.

## 5. Restart and smoke-test

Restart the server so it picks up the new env vars:

```bash
cd backend && npm start
```

Wait ~30 seconds for the first sync tick.

**Per-connector health:**
```bash
curl -s http://127.0.0.1:3000/api/sync | jq
```
Every connector the user configured should show `enabled: true`, `lastError: null`. Anything red — read the error and cross-reference the "Common errors" table below.

**Calendar:**
```bash
curl -s http://127.0.0.1:3000/api/calendar/today | jq '.calendar.events | length'
```
Should return a number (0 is fine if the user has no events today).

**Tasks:**
```bash
curl -s http://127.0.0.1:3000/api/tasks | jq '. | length'
```
Should return a number.

If both return numbers and `/api/sync` is all green, you're done. Tell the user: open <http://127.0.0.1:3000>.

## Common errors

| Symptom | Cause / fix |
|---|---|
| `Access blocked: Lighthouse has not completed the Google verification process` | User's Gmail wasn't added as Test User in step 3c. |
| `redirect_uri_mismatch` | Redirect URI in step 3d must match exactly. Check `127.0.0.1` vs `localhost`, trailing slashes. |
| `/auth/google` returns 503 | `.env` missing Google keys, or server wasn't restarted after editing. |
| ClickUp `lastError: "ClickUp 401"` | Wrong token. Personal API tokens start with `pk_`, not OAuth-style. |
| Notion `lastError: "object_not_found"` | Database not shared with the integration. Open the DB, ··· → Connect to → pick the integration. |
| Notion `lastError: "unauthorized"` | API key is for a different workspace, or the integration was deleted. |
| `gtasks` lastError: `403 Insufficient Permission` | Connected Google before Tasks scope was added. Re-visit `/auth/google` to re-consent. |
| Workflowy returns nothing | Parent node has no open children (completed items are filtered out). Try `WORKFLOWY_PARENT_ID=inbox`. |
| Things 3 sync errors with "Not authorized to send Apple events" | macOS denied Automation. System Settings → Privacy & Security → Automation → enable for the terminal/Node. |
| Calendar shows no events but you have some today | First sync hasn't run yet, or the user connected a Google account that doesn't own the events. Wait 60s and re-check `/api/sync` for `gcal`. |

## Keep it running after you close the terminal

Two options. Pick what the user prefers:

**Simple (terminal-friendly)**: leave `npm start` running in a tmux/screen session, or in a terminal tab they don't close.

**Always-on (auto-start at login)**: a launchd plist. Build it after install — not part of the install flow. The skeleton:

```bash
NPM=$(which npm) DIR="$(pwd)/backend" HOME_DIR="$HOME"
cat > ~/Library/LaunchAgents/com.lighthouse.server.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.lighthouse.server</string>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>ProgramArguments</key>
  <array><string>$NPM</string><string>start</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME_DIR/Library/Logs/lighthouse.log</string>
  <key>StandardErrorPath</key><string>$HOME_DIR/Library/Logs/lighthouse.log</string>
</dict>
</plist>
EOF
launchctl load ~/Library/LaunchAgents/com.lighthouse.server.plist
```

Stop with `launchctl unload ~/Library/LaunchAgents/com.lighthouse.server.plist`.
