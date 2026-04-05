const pool = require('../db');

// [MED-6] 실제 inquiries 테이블 스키마에 맞게 수정
// 이전: (name, email, message) — 실제 테이블에 없는 컬럼 → 런타임 "Unknown column" 오류 발생
// 수정: (guest_name, guest_email, title, content) — 마이그레이션 스키마와 일치
exports.createInquiry = async ({ name, email, message }) => {
	const sql = `
    INSERT INTO inquiries (guest_name, guest_email, title, content)
    VALUES (?, ?, ?, ?)
  `;
	// title 기본값: '문의' (API 경로는 별도 제목 없이 message만 받으므로)
	const [result] = await pool.execute(sql, [name, email, '문의', message]);
	return { id: result.insertId };
};

exports.listInquiries = async ({ limit = 20, offset = 0 } = {}) => {
	const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
	const safeOffset = Math.max(Number(offset) || 0, 0);

	// [MED-6] 실제 컬럼명으로 수정 (guest_name, guest_email, content)
	const sql = `
    SELECT id, guest_name AS name, guest_email AS email, content AS message, created_at
    FROM inquiries
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;
	const [rows] = await pool.execute(sql, [safeLimit, safeOffset]);
	return rows;
};
