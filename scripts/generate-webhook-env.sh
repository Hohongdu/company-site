#!/usr/bin/env bash
set -euo pipefail

# 사용법:
#   scripts/generate-webhook-env.sh --ip 192.168.0.120
#   scripts/generate-webhook-env.sh --domain n8n.example.com
#   scripts/generate-webhook-env.sh --auto-ip

MODE=""
VALUE=""
TOKEN="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ip)
      MODE="ip"; VALUE="${2:-}"; shift 2 ;;
    --domain)
      MODE="domain"; VALUE="${2:-}"; shift 2 ;;
    --auto-ip)
      MODE="auto-ip"; shift ;;
    *)
      echo "알 수 없는 옵션: $1" >&2
      exit 1 ;;
  esac
done

if [[ -z "$MODE" ]]; then
  echo "옵션 필요: --ip <IP> | --domain <DOMAIN> | --auto-ip" >&2
  exit 1
fi

if [[ "$MODE" == "auto-ip" ]]; then
  VALUE="$(hostname -I | awk '{print $1}')"
  MODE="ip"
fi

if [[ -z "$VALUE" ]]; then
  echo "값이 비어있습니다." >&2
  exit 1
fi

if [[ "$MODE" == "ip" ]]; then
  WEBHOOK_BASE="http://${VALUE}:5678"
else
  WEBHOOK_BASE="https://${VALUE}"
fi

cat <<ENVVARS
# n8n(deploy/n8n/.env)
WEBHOOK_URL=${WEBHOOK_BASE}/

# app(.env)
EMAIL_WEBHOOK_URL=${WEBHOOK_BASE}/webhook/company-site-email
EMAIL_WEBHOOK_TOKEN=${TOKEN}
ENVVARS
