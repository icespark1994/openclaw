#!/usr/bin/env bash
# Run the Feishu AI-medtech daily news digest.
# Designed to be called from a system crontab entry.
#
# Usage:
#   bash scripts/run-feishu-news.sh
#
# Crontab example (Beijing time 08:30):
#   TZ=Asia/Shanghai
#   30 8 * * * /home/alan/bot-core/scripts/run-feishu-news.sh >> /home/alan/logs/feishu-news.log 2>&1
#
# Required env (sourced from .env in project root):
#   OPENROUTER_API_KEY
#   FEISHU_WEBHOOK_URL
#
# Optional env:
#   FEISHU_WEBHOOK_SECRET
#   BRAVE_API_KEY
#   AI_MEDTECH_NEWS_TIMEZONE  (default: Asia/Shanghai)
set -euo pipefail

# Resolve project root (parent of scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

# Load .env if present (never fail if missing)
ENV_FILE="$PROJECT_ROOT/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck source=.env
  source "$ENV_FILE"
  set +a
fi

# Timestamp for log readability
echo "=== feishu-news run @ $(date '+%Y-%m-%d %H:%M:%S %Z') ==="

# Prefer bun; fall back to node if bun not in PATH
if command -v bun >/dev/null 2>&1; then
  exec bun "$PROJECT_ROOT/src/feishu/runner.ts"
else
  echo "bun not found — attempting node runner (requires compiled dist)" >&2
  exec node "$PROJECT_ROOT/dist/feishu/runner.js"
fi
