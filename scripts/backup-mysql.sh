#!/usr/bin/env bash
# MySQL 일자별 백업 스크립트
# - mysqldump → gzip → backups/{DB_NAME}-YYYY-MM-DD.sql.gz
# - 14일 이상 된 백업은 자동 삭제
# - .env 의 DB_* 값을 사용
#
# Usage:
#   ./scripts/backup-mysql.sh
#
# Cron 예시 (매일 03:00):
#   0 3 * * * /path/to/company-site/scripts/backup-mysql.sh >> /path/to/company-site/logs/backup.log 2>&1

set -euo pipefail

# 이 스크립트 위치 기준 프로젝트 루트
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

# .env 로드 (export 없이 정의된 KEY=VALUE 형식도 처리)
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:?DB_USER not set}"
DB_PASS="${DB_PASS:-${DB_PASSWORD:-}}"
DB_NAME="${DB_NAME:?DB_NAME not set}"

if [ -z "${DB_PASS}" ]; then
  echo "[backup] ERROR: DB_PASS (or DB_PASSWORD) not set in .env" >&2
  exit 1
fi

BACKUP_DIR="${PROJECT_ROOT}/backups"
mkdir -p "${BACKUP_DIR}"

TIMESTAMP="$(date +%Y-%m-%d)"
OUTFILE="${BACKUP_DIR}/${DB_NAME}-${TIMESTAMP}.sql.gz"

echo "[backup] $(date -Iseconds) start: ${DB_NAME} → ${OUTFILE}"

# mysqldump
# - --single-transaction: InnoDB lock-free 백업 (DDL 발생 시 일관성은 보장 안 됨)
# - --quick: 한 번에 한 행씩 fetch (메모리 사용 감소)
# - --routines, --triggers: 저장 프로시저/트리거 포함
# - --skip-comments: 출력 사이즈 감소
mysqldump \
  --host="${DB_HOST}" \
  --port="${DB_PORT}" \
  --user="${DB_USER}" \
  --password="${DB_PASS}" \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  --skip-comments \
  --default-character-set=utf8mb4 \
  "${DB_NAME}" \
  | gzip -c > "${OUTFILE}"

# 결과 확인
if [ ! -s "${OUTFILE}" ]; then
  echo "[backup] ERROR: 빈 파일 생성됨 — 백업 실패" >&2
  rm -f "${OUTFILE}"
  exit 2
fi

SIZE_HUMAN="$(du -h "${OUTFILE}" | cut -f1)"
echo "[backup] $(date -Iseconds) ok: ${OUTFILE} (${SIZE_HUMAN})"

# 14일 이상된 백업 삭제
DELETED_COUNT=$(find "${BACKUP_DIR}" -name "${DB_NAME}-*.sql.gz" -type f -mtime +14 -print -delete | wc -l)
if [ "${DELETED_COUNT}" -gt 0 ]; then
  echo "[backup] 회전: ${DELETED_COUNT}개 백업 삭제 (14일 이상)"
fi

echo "[backup] $(date -Iseconds) done"
