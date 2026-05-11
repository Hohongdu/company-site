// db.js
// ─────────────────────────────────────────────────────────────────────────────
// [보안] L-1: DB 크레덴셜을 운영 환경 로그에 노출하지 않음
//        C-3: 하드코딩 DB 비밀번호('111111') 폴백 제거
// ─────────────────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
	// 개발 환경에서만 접속 정보 출력 (비밀번호 제외)
	console.log('[DB ENV]', {
		DB_HOST: process.env.DB_HOST,
		DB_USER: process.env.DB_USER,
		DB_NAME: process.env.DB_NAME,
	});
}

// [CODEX-1] DB_PASS / DB_PASSWORD 두 이름 모두 허용 (.env.example과 런타임 계약 통일)
// DB_PASS 우선 사용, 없으면 DB_PASSWORD 폴백 (신규 배포 호환성)
const _dbPassword = process.env.DB_PASS || process.env.DB_PASSWORD || '';
if (!_dbPassword) {
	console.warn('[WARN] DB_PASS(또는 DB_PASSWORD)가 설정되지 않았습니다. DB 연결에 실패할 수 있습니다.');
}

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
	host:              process.env.DB_HOST      || 'localhost',
	port:              parseInt(process.env.DB_PORT || '3306', 10),   // [CODEX-1] DB_PORT 반영
	user:              process.env.DB_USER      || 'root',
	password:          _dbPassword,
	database:          process.env.DB_NAME      || 'company_site',
	waitForConnections: true,
	connectionLimit:   Number(process.env.DB_CONN_LIMIT || 10),
	queueLimit:        0,
	timezone:          '+09:00',
});

module.exports = pool;
