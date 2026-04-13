#!/bin/bash
# install-all.sh
# Build package-lock.json for each services
#
# Usage :
#   bash scripts/install-all.sh
#   npm run install:all

set -e

SERVICES=("api-gateway" "user-service" "task-service" "notification-service" "frontend")
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "📦 TaskFlow — install dependencies"
echo "==========================================="

for service in "${SERVICES[@]}"; do
  echo ""
  echo "▶️ $service ..."
  cd "$ROOT_DIR/$service"
  npm install --workspaces=false

  if [ -f "package-lock.json" ]; then
    echo "  ✅ $service dependencies installed successfully"
  else
    echo "  ❌ $service dependencies installation failed (missing package-lock.json)" >&2
    exit 1
  fi
done
