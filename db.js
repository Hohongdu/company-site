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

// [보안] DB_PASS 미설정 시 경고 — 하드코딩 폴백 완전 제거
if (!process.env.DB_PASS) {
	console.warn('[WARN] DB_PASS is not set! Database connection will likely fail. Set DB_PASS in .env');
}

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
	host:     process.env.DB_HOST     || 'localhost',
	user:     process.env.DB_USER     || 'root',
	password: process.env.DB_PASS     || '',          // 하드코딩 폴백 제거 — 반드시 .env에 DB_PASS 설정
	database: process.env.DB_NAME     || 'company_site',
	waitForConnections: true,
	connectionLimit: Number(process.env.DB_CONN_LIMIT || 10),
	queueLimit: 0,
	timezone: '+09:00',
});

module.exports = pool;
