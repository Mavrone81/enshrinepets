#!/usr/bin/env bash
#
# Polls GitHub for new commits on main and deploys when there are any.
# Installed as a per-minute cron job on the droplet, this gives
# "push to main -> live in ~1 minute" without any GitHub credentials.
#
# A lock prevents overlapping runs; output goes to /var/log/enshrine-deploy.log.
set -euo pipefail

export NVM_DIR="${NVM_DIR:-/root/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true

REPO_DIR="/root/enshrinepets"
LOCK="/tmp/enshrine-autopull.lock"

# Skip if a deploy is already running.
exec 9>"$LOCK"
flock -n 9 || exit 0

cd "$REPO_DIR"
git fetch origin main --quiet
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/main)"

if [ "$LOCAL" != "$REMOTE" ]; then
  echo "[$(date -u '+%F %T UTC')] new commit $REMOTE (was $LOCAL) — deploying"
  "$REPO_DIR/enshrine-pets-website/scripts/deploy.sh"
fi
