#!/bin/bash
set -euo pipefail

IMAGE="app-app"

echo "==> Checking for previous image..."
HAS_PREV=$(ssh mikrus "docker image inspect ${IMAGE}:prev > /dev/null 2>&1 && echo yes || echo no")

if [ "$HAS_PREV" = "no" ]; then
    echo "==> No :prev image found. Nothing to roll back to."
    exit 1
fi

echo "==> Stopping current container..."
ssh mikrus "cd /app && docker compose down"

echo "==> Restoring previous image..."
ssh mikrus "docker tag ${IMAGE}:prev ${IMAGE}:latest"

echo "==> Starting rolled-back container..."
ssh mikrus "cd /app && docker compose up -d"

echo "==> Waiting for health check..."
sleep 10

HEALTH=$(ssh mikrus "curl -sf http://localhost:20312/health" 2>/dev/null || echo "FAILED")

if echo "$HEALTH" | grep -q '"status":"ok"'; then
    echo "==> Rollback successful!"
    echo "$HEALTH"
else
    echo "==> Health check failed after rollback! Response: $HEALTH"
    exit 1
fi
