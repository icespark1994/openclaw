#!/usr/bin/env bash
# Start finance-bot gateway locally, sourcing API keys from .env
# Usage: ./scripts/start-finance-bot.sh [--port 18790]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
case "${1:-}" in
  --port) PORT="${2:-18790}" ;;
  [0-9]*) PORT="$1" ;;
  *) PORT=18790 ;;
esac

ENV_FILE="$SCRIPT_DIR/.env"
CONFIG_PATH="$HOME/.openclaw/finance-bot-config/openclaw.json"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: .env not found at $ENV_FILE" >&2; exit 1
fi
if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "ERROR: finance-bot config not found at $CONFIG_PATH" >&2; exit 1
fi

# Stop any existing finance-bot on this port
pkill -f "OPENCLAW_BOT_ID=finance-bot" 2>/dev/null || true
sleep 1

# Source .env so API keys are in the shell environment
set -a
# shellcheck source=.env
source "$ENV_FILE"
set +a

export OPENCLAW_BOT_ID=finance-bot
export OPENCLAW_CONFIG_PATH="$CONFIG_PATH"
export GOOGLE_SHEETS_CREDENTIALS_FILE="$HOME/.openclaw/bot-secrets/google-credentials.json"
# GOOGLE_SPREADSHEET_ID is sourced from .env above; verify it is set
if [[ -z "${GOOGLE_SPREADSHEET_ID:-}" ]]; then
  echo "ERROR: GOOGLE_SPREADSHEET_ID is not set in $ENV_FILE" >&2; exit 1
fi

exec node "$SCRIPT_DIR/dist/index.js" gateway run \
  --bind loopback --port "$PORT" --allow-unconfigured
