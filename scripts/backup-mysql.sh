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

# 앱과 같은 dotenv 문법을 사용하고 필요한 DB 설정만 읽는다.
if [ -f .env ]; then
  {
    IFS= read -r -d '' DB_HOST &&
    IFS= read -r -d '' DB_PORT &&
    IFS= read -r -d '' DB_USER &&
    IFS= read -r -d '' DB_PASS &&
    IFS= read -r -d '' DB_PASSWORD &&
    IFS= read -r -d '' DB_NAME
  } < <(node <<'NODE'
const { error } = require('dotenv').config({ quiet: true, override: true });
if (error) throw error;

for (const name of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASS', 'DB_PASSWORD', 'DB_NAME']) {
  process.stdout.write((process.env[name] ?? '') + '\0');
}
NODE
  )
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
TEMP_OUTFILE="$(mktemp "${OUTFILE}.tmp.XXXXXX")"
trap 'rm -f -- "${TEMP_OUTFILE}"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

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
  | gzip -c > "${TEMP_OUTFILE}"

# 백업이 완료된 후 같은 디렉터리 안에서 최종 파일로 교체한다.
if [ ! -s "${TEMP_OUTFILE}" ]; then
  echo "[backup] ERROR: 빈 파일 생성됨 — 백업 실패" >&2
  exit 2
fi

mv -f -- "${TEMP_OUTFILE}" "${OUTFILE}"

SIZE_HUMAN="$(du -h "${OUTFILE}" | cut -f1)"
echo "[backup] $(date -Iseconds) ok: ${OUTFILE} (${SIZE_HUMAN})"

# 14일 이상된 백업 삭제
DELETED_COUNT=$(find "${BACKUP_DIR}" -name "${DB_NAME}-*.sql.gz" -type f -mtime +14 -print -delete | wc -l)
if [ "${DELETED_COUNT}" -gt 0 ]; then
  echo "[backup] 회전: ${DELETED_COUNT}개 백업 삭제 (14일 이상)"
fi

echo "[backup] $(date -Iseconds) done"
