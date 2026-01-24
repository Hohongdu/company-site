// db.js
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
	host: process.env.DB_HOST || 'localhost',
	user: process.env.DB_USER || 'root',
	password: process.env.DB_PASS || '111111',
	database: process.env.DB_NAME || 'company_site',
	waitForConnections: true,
	connectionLimit: Number(process.env.DB_CONN_LIMIT || 10),
	queueLimit: 0,
	timezone: '+09:00', // (선택) 한국 시간 맞추고 싶으면 추천
});

module.exports = pool;
