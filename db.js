// db.js
const mysql = require('mysql2/promise');

// 환경변수(.env)로 관리 가능
const pool = mysql.createPool({
	host: 'localhost',
	user: 'root',
	password: '111111',
	database: 'company_site',
	waitForConnections: true,
	connectionLimit: 10,
	queueLimit: 0,
});

module.exports = pool;
