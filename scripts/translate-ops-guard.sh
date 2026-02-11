#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/scripts/docker-compose.translate.yml}"
TRANSLATE_HEALTH_URL="${TRANSLATE_HEALTH_URL:-http://127.0.0.1:5000/translate}"
APP_TRANSLATE_URL="${APP_TRANSLATE_URL:-http://127.0.0.1:3000/api/translate}"
PM2_APP_NAME="${PM2_APP_NAME:-company-site}"
HEALTH_RETRIES="${HEALTH_RETRIES:-4}"
HEALTH_DELAY_SEC="${HEALTH_DELAY_SEC:-2}"

log() {
  echo "[translate-ops] $*"
}

health_check() {
  local url="$1"
  curl -sS -m 8 -X POST "$url" \
    -H "Content-Type: application/json" \
    -d '{"q":"안녕하세요","source":"ko","target":"en","format":"text"}' >/dev/null
}

retry_health_check() {
  local url="$1"
  local label="$2"
  local i

  for ((i=1; i<=HEALTH_RETRIES; i++)); do
    if health_check "$url"; then
      log "$label health check ok (attempt $i/$HEALTH_RETRIES)"
      return 0
    fi
    log "$label health check failed (attempt $i/$HEALTH_RETRIES)"
    sleep "$HEALTH_DELAY_SEC"
  done

  return 1
}

log "starting libretranslate container"
docker compose -f "$COMPOSE_FILE" up -d libretranslate

if ! retry_health_check "$TRANSLATE_HEALTH_URL" "libretranslate"; then
  log "restarting libretranslate container"
  docker compose -f "$COMPOSE_FILE" restart libretranslate

  if ! retry_health_check "$TRANSLATE_HEALTH_URL" "libretranslate"; then
    log "libretranslate health check still failing"
    exit 1
  fi
fi

if ! retry_health_check "$APP_TRANSLATE_URL" "app proxy"; then
  if command -v pm2 >/dev/null 2>&1; then
    log "restarting pm2 app: $PM2_APP_NAME"
    pm2 restart "$PM2_APP_NAME" --update-env
    retry_health_check "$APP_TRANSLATE_URL" "app proxy after pm2 restart"
  else
    log "pm2 command not found; skip app restart"
    exit 1
  fi
fi

log "all checks passed"
