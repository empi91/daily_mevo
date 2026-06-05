#!/bin/bash
set -euo pipefail

APP_DIR="/app"
IMAGE="app-app"

echo "==> Connecting to mikrus..."

echo "==> Tagging current image as :prev..."
ssh mikrus "docker tag ${IMAGE}:latest ${IMAGE}:prev 2>/dev/null || echo 'No existing image to tag'"

echo "==> Pulling latest code..."
ssh mikrus "cd ${APP_DIR} && git pull"

echo "==> Building new image..."
ssh mikrus "cd ${APP_DIR} && docker compose build"

echo "==> Restarting container..."
ssh mikrus "cd ${APP_DIR} && docker compose up -d"

echo "==> Waiting for health check (up to 90s)..."
for i in $(seq 1 18); do
    sleep 5
    HEALTH=$(ssh mikrus "curl -sf http://localhost:20312/health" 2>/dev/null || echo "")
    if echo "$HEALTH" | grep -q '"status":"ok"'; then
        break
    fi
done
HEALTH=${HEALTH:-FAILED}

if echo "$HEALTH" | grep -q '"status":"ok"'; then
    echo "==> Deploy successful!"
    echo "$HEALTH"
else
    echo "==> Health check failed! Response: $HEALTH"
    echo "==> Run ./rollback.sh to restore previous version."
    exit 1
fi
