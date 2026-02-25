#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "[bootstrap] .env 파일이 없어 .env.example 기반으로 생성했습니다."
  echo "[bootstrap] deploy/n8n/.env에서 비밀번호/키를 반드시 수정하세요."
fi

mkdir -p data

echo "[bootstrap] 완료: docker compose up -d 실행 가능"
