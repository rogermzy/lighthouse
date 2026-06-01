#!/usr/bin/env bash
# Update Lighthouse on the server. Run after `git pull` lands new code.
#
# Pulls latest main, reinstalls deps if package.json changed, and force-
# restarts the launchd unit so the new code is live.
#
# Run from the repo root on the server:
#   ./scripts/update.sh

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.rogermzy.lighthouse"

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }

cd "$REPO"

bold "1. git pull"
LOCK_BEFORE="$(shasum backend/package-lock.json 2>/dev/null | awk '{print $1}' || echo none)"
git pull --ff-only
LOCK_AFTER="$(shasum backend/package-lock.json 2>/dev/null | awk '{print $1}' || echo none)"

if [ "$LOCK_BEFORE" != "$LOCK_AFTER" ]; then
    bold "2. lockfile changed → npm install"
    (cd backend && npm install --no-audit --no-fund)
else
    ok "lockfile unchanged — skipping npm install"
fi

bold "3. restart launchd unit"
launchctl kickstart -k "gui/$UID/$LABEL"
ok "restarted"

# Brief healthcheck.
sleep 2
if curl -sf -m 3 "http://127.0.0.1:7373/api/meta" >/dev/null; then
    ok "server responding on http://127.0.0.1:7373"
else
    printf "  \033[33m!\033[0m server didn't respond yet — tail ~/Library/Logs/Lighthouse.err.log\n"
fi
