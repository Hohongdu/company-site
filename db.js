// db.js
// MySQL 커넥션 풀 초기화
// 모든 DB 접속 정보는 .env 환경변수에서만 읽는다.
// 하드코딩 폴백 값 금지 — 설정 누락 시 즉시 에러로 명확히 알린다.

'use strict';

const mysql = require('mysql2/promise');

// ── 필수 환경변수 검증 ──────────────────────────────────
const DB_HOST = process.env.DB_HOST;
const DB_USER = process.env.DB_USER;
const DB_PASS = process.env.DB_PASS;
const DB_NAME = process.env.DB_NAME;

if (!DB_HOST || !DB_USER || !DB_PASS || !DB_NAME) {
	// 서버 시작 시 즉시 크래시 — 잘못된 설정으로 실행되는 것을 방지
	throw new Error(
		'[db] 필수 환경변수 누락: DB_HOST, DB_USER, DB_PASS, DB_NAME 을 .env 파일에 설정하세요.',
	);
}

// 개발 환경에서만 연결 정보 로그 (비밀번호 절대 출력 안 함)
if (process.env.NODE_ENV !== 'production') {
	console.log('[DB] Connecting to', DB_HOST, '/', DB_NAME, 'as', DB_USER);
}

const pool = mysql.createPool({
	host: DB_HOST,
	user: DB_USER,
	password: DB_PASS,
	database: DB_NAME,
	waitForConnections: true,
	connectionLimit: Number(process.env.DB_CONN_LIMIT || 10),
	queueLimit: 0,
	timezone: '+09:00',
});

module.exports = pool;
