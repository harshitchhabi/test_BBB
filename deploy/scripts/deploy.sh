#!/usr/bin/env bash
# Run this ON THE SERVER, as the `bbb` user, from /opt/bricksbybid, for
# every update after the first (the first-ever setup is
# deploy/scripts/provision.sh). Pulls the latest main, rebuilds, runs
# any new migrations, and restarts both services.
#
#   cd /opt/bricksbybid && ./deploy/scripts/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/../.."   # repo root (deploy/scripts/.. /..)

echo "==> Pulling latest main"
git pull origin main

echo "==> Installing dependencies (all workspaces)"
npm ci

echo "==> Running any new migrations"
# frontend.env also has DATABASE_URL, but the migrate script lives in
# packages/db and doesn't source systemd's EnvironmentFile itself.
set -a
source /etc/bricksbybid/backend.env
set +a
(cd packages/db && npm run migrate)

echo "==> Building frontend"
# NEXT_PUBLIC_* vars (NEXT_PUBLIC_WS_URL) are inlined into the client
# bundle at BUILD time, not read at runtime - systemd's EnvironmentFile
# only takes effect for the running process, so the build step needs the
# real env loaded into this shell first, or the browser would ship with
# whatever NEXT_PUBLIC_WS_URL happened to be unset/wrong.
set -a
source /etc/bricksbybid/frontend.env
set +a
(cd frontend && npm run build)

echo "==> Restarting services"
sudo systemctl restart bbb-backend
sudo systemctl restart bbb-frontend

echo "==> Done. Checking status:"
sleep 2
sudo systemctl --no-pager status bbb-backend bbb-frontend
curl -sf http://localhost:8080/health && echo
curl -so /dev/null -w "frontend: %{http_code}\n" http://localhost:3000
