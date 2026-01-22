const pool = require('../db');

exports.createInquiry = async ({ name, email, message }) => {
	const sql = `
    INSERT INTO inquiries (name, email, message)
    VALUES (?, ?, ?)
  `;
	const [result] = await pool.execute(sql, [name, email, message]);
	return { id: result.insertId };
};

exports.listInquiries = async ({ limit = 20, offset = 0 } = {}) => {
	const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
	const safeOffset = Math.max(Number(offset) || 0, 0);

	const sql = `
    SELECT id, name, email, message, created_at
    FROM inquiries
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;
	const [rows] = await pool.execute(sql, [safeLimit, safeOffset]);
	return rows;
};
