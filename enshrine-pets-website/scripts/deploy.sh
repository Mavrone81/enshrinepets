#!/usr/bin/env bash
#
# Production deploy for the Enshrine website (runs ON the droplet).
#
# This is the ONLY command the GitHub Actions deploy key is allowed to run
# (it is pinned via a forced command in ~/.ssh/authorized_keys), so a leaked
# deploy key can only trigger a redeploy — not run arbitrary commands.
#
# It pulls the latest main, installs deps, and reloads the PM2 process.
# Live, admin-editable files (data/content.json, data/i18n/*.json,
# data/users.json, public/uploads/*) are git-ignored, so they are NOT touched.
set -euo pipefail

# Make node/npm/pm2 available when invoked from a minimal environment (cron).
export NVM_DIR="${NVM_DIR:-/root/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true

REPO_DIR="/root/enshrinepets"
APP_DIR="$REPO_DIR/enshrine-pets-website"
PM2_NAME="enshrinepets"

echo "==> Deploy started $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

cd "$REPO_DIR"
git fetch --all --prune
git reset --hard origin/main

cd "$APP_DIR"
# Install exactly what the lockfile specifies (production deps only).
npm ci --omit=dev

# Reload the running app (zero-downtime where possible); re-reads .env.
pm2 reload "$PM2_NAME" --update-env
pm2 save >/dev/null 2>&1 || true

echo "==> Deploy complete at $(git rev-parse --short HEAD): $(git log -1 --pretty=%s)"
