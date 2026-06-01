#!/usr/bin/env bash
# Lighthouse — fresh-server install for a always-on Mac (e.g., a Mac mini).
#
# What it does:
#   1. Checks node + npm are present
#   2. Runs `npm install` in backend/
#   3. Renders scripts/com.rogermzy.lighthouse.plist into ~/Library/LaunchAgents/
#   4. Bootstraps the launchd unit so the server starts on login + restarts on crash
#
# What it does NOT do (because they need you):
#   - Install Tailscale (brew install --cask tailscale, then sign in)
#   - tailscale serve --bg https / http://localhost:7373 (for HTTPS)
#   - Update the Google OAuth redirect URI in Google Cloud Console
#   - Copy backend/.env or backend/data.db from your laptop
#
# Run from the repo root:
#   ./scripts/install-on-server.sh

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOME_DIR="$HOME"
LABEL="com.rogermzy.lighthouse"
PLIST_DST="$HOME_DIR/Library/LaunchAgents/$LABEL.plist"

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
die()  { printf "  \033[31m✗\033[0m %s\n" "$1" >&2; exit 1; }

bold "1. Preflight"

NODE_BIN="$(command -v node || true)"
[ -z "$NODE_BIN" ] && die "node not found on PATH. Install via Homebrew: brew install node"
NODE_VERSION="$(node -v)"
ok "node $NODE_VERSION at $NODE_BIN"

command -v npm >/dev/null || die "npm not found"
ok "npm $(npm -v)"

if [ ! -f "$REPO/backend/package.json" ]; then
    die "Expected $REPO/backend/package.json — is this the right repo path?"
fi
ok "repo at $REPO"

bold "2. Install dependencies"
(cd "$REPO/backend" && npm install --no-audit --no-fund)
ok "npm install complete"

bold "3. Check for .env and data.db"
if [ ! -f "$REPO/backend/.env" ]; then
    warn ".env missing — copy it from your laptop before continuing:"
    warn "  scp your-laptop:~/claude/adhd/backend/.env $REPO/backend/.env"
else
    ok ".env present"
fi
if [ ! -f "$REPO/backend/data.db" ]; then
    warn "data.db missing — a fresh DB will be created on first launch."
    warn "To preserve your tasks/journal, copy from your laptop first:"
    warn "  scp your-laptop:~/claude/adhd/backend/data.db $REPO/backend/data.db"
else
    ok "data.db present ($(du -h "$REPO/backend/data.db" | cut -f1))"
fi

bold "4. Install launchd unit"
mkdir -p "$HOME_DIR/Library/LaunchAgents"
mkdir -p "$HOME_DIR/Library/Logs"

# Boot out any existing instance before rewriting the plist so we never
# leave a stale process running against an old config.
if launchctl print "gui/$UID/$LABEL" >/dev/null 2>&1; then
    launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
    ok "stopped previous launchd unit"
fi

sed \
    -e "s|__NODE__|$NODE_BIN|g" \
    -e "s|__REPO__|$REPO|g" \
    -e "s|__HOME__|$HOME_DIR|g" \
    "$REPO/scripts/$LABEL.plist" > "$PLIST_DST"
ok "rendered $PLIST_DST"

launchctl bootstrap "gui/$UID" "$PLIST_DST"
ok "launchd unit bootstrapped"

# Give it a couple seconds to come up, then verify.
sleep 3
if curl -sf -m 3 "http://127.0.0.1:7373/api/meta" >/dev/null; then
    ok "server responding on http://127.0.0.1:7373"
else
    warn "server didn't respond yet — tail logs with:"
    warn "  tail -f ~/Library/Logs/Lighthouse.err.log"
fi

cat <<EOF

$(bold "Done. Next steps:")

  1. Install Tailscale and sign in (same tailnet as your laptop + phone):
       brew install --cask tailscale
       open -a Tailscale

  2. Note this machine's tailnet name (System Settings → Network → Tailscale,
     or \`tailscale status\`). It'll look like: mini.<tailnet-name>.ts.net

  3. Enable HTTPS for OAuth (required by Google for non-localhost hosts):
       sudo tailscale cert mini.<tailnet-name>.ts.net
       sudo tailscale serve --bg https / http://localhost:7373

  4. Add the new redirect URI in Google Cloud Console → APIs & Services →
     Credentials → your OAuth client → Authorized redirect URIs:
       https://mini.<tailnet-name>.ts.net/auth/google/callback

     Then set GOOGLE_REDIRECT_URI in backend/.env to the same value, and
     restart the server:
       launchctl kickstart -k gui/\$UID/$LABEL

  5. On your laptop, point the Mac app at the remote URL:
       defaults write com.rogermzy.lighthouse LighthouseRemoteURL \\
           "https://mini.<tailnet-name>.ts.net"
       open -a Lighthouse

Manage the server:
  launchctl kickstart -k gui/\$UID/$LABEL     # restart
  launchctl bootout    gui/\$UID/$LABEL       # stop
  tail -f ~/Library/Logs/Lighthouse.err.log    # logs
EOF
