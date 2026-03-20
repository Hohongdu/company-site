// db.js
const mysql = require('mysql2/promise');

if (!process.env.DB_PASS) {
	throw new Error('[db] DB_PASS 환경변수가 설정되지 않았습니다. .env 파일을 확인하세요.');
}

const pool = mysql.createPool({
	host: process.env.DB_HOST || 'localhost',
	user: process.env.DB_USER || 'root',
	password: process.env.DB_PASS,
	database: process.env.DB_NAME || 'company_site',
	waitForConnections: true,
	connectionLimit: Number(process.env.DB_CONN_LIMIT || 10),
	queueLimit: 0,
	timezone: '+09:00',
});

module.exports = pool;
