#!/bin/bash
set -euo pipefail

IMAGE="app-app"

echo "==> Checking for previous image..."
if ! docker image inspect ${IMAGE}:prev > /dev/null 2>&1; then
    echo "==> No :prev image found. Nothing to roll back to."
    exit 1
fi

echo "==> Stopping current container..."
cd /app && docker compose down

echo "==> Restoring previous image..."
docker tag ${IMAGE}:prev ${IMAGE}:latest

echo "==> Starting rolled-back container..."
cd /app && docker compose up -d

echo "==> Waiting for health check (up to 90s)..."
for i in $(seq 1 18); do
    sleep 5
    HEALTH=$(curl -sf http://localhost:20312/health 2>/dev/null || echo "")
    if echo "$HEALTH" | grep -q '"status":"ok"'; then
        echo "==> Rollback successful!"
        echo "$HEALTH"
        exit 0
    fi
    echo "Attempt $i/18 — not healthy yet..."
done

echo "==> Health check failed after rollback!"
exit 1
