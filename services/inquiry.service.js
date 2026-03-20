// H-5 수정: 실제 inquiries 테이블 스키마에 맞게 수정
const pool = require('../db');

exports.createInquiry = async ({ orderId, userId, guestName, guestEmail, guestPhone, title, content }) => {
	const [result] = await pool.execute(
		`INSERT INTO inquiries (order_id, user_id, guest_name, guest_email, guest_phone, title, content, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'NEW')`,
		[orderId || null, userId || null, guestName || null, guestEmail || null, guestPhone || null, title, content],
	);
	return { id: result.insertId };
};

exports.listInquiries = async ({ limit = 20, offset = 0 } = {}) => {
	const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
	const safeOffset = Math.max(Number(offset) || 0, 0);
	const [rows] = await pool.execute(
		`SELECT id, guest_name, guest_email, title, content, status, created_at
     FROM inquiries
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
		[safeLimit, safeOffset],
	);
	return rows;
};
