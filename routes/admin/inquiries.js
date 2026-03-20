const express = require('express');
const csurf = require('../../lib/csurf');
const db = require('../../db');
const { sendInquiryReplyEmail } = require('../../services/notification.service');
const asyncHandler = require('../../lib/asyncHandler');

const router = express.Router();
const csrfProtection = csurf({ ignoreMethods: ['GET', 'HEAD', 'OPTIONS'] });

/* =========================
   문의 관리
========================= */
router.get('/inquiries', asyncHandler(async (req, res) => {
	let inquiries = [];
	try {
		[inquiries] = await db.execute(
			`SELECT i.*,
                COALESCE(o.order_number, IF(i.order_id IS NOT NULL, CONCAT('ORD-', i.order_id), NULL)) AS order_number,
                u.name  AS user_name,
                u.email AS user_email
               FROM inquiries i
               LEFT JOIN orders o ON o.id = i.order_id
               LEFT JOIN users u ON u.id = i.user_id
               ORDER BY i.created_at DESC`,
		);
	} catch (q1Err) {
		console.error('[admin/inquiries] 문의 쿼리 오류:', q1Err.message);
		// order_number 컬럼 없는 경우 fallback
		[inquiries] = await db.execute(
			`SELECT i.*,
                NULL AS order_number,
                u.name  AS user_name,
                u.email AS user_email
               FROM inquiries i
               LEFT JOIN users u ON u.id = i.user_id
               ORDER BY i.created_at DESC`,
		);
	}

	return res.render('admin/inquiries', { inquiries, csrfToken: req.csrfToken() });
}));

router.post('/inquiries/:id/reply', csrfProtection, asyncHandler(async (req, res) => {
	const inquiryId = Number(req.params.id);
	const answerContent = String(req.body.answerContent || '').trim();

	if (!inquiryId || !answerContent) {
		return res.status(400).send('답변 내용이 필요합니다.');
	}

	const [[inquiry]] = await db.execute(
		`SELECT i.*, u.name AS user_name, u.email AS user_email
       FROM inquiries i
       LEFT JOIN users u ON u.id = i.user_id
       WHERE i.id = ?
       LIMIT 1`,
		[inquiryId],
	);

	if (!inquiry) {
		return res.status(404).send('문의가 존재하지 않습니다.');
	}

	const recipientEmail = inquiry.user_email || inquiry.guest_email || null;
	const recipientName = inquiry.user_name || inquiry.guest_name || null;

	// 이메일 발송 시도
	let notificationChannel = recipientEmail ? 'EMAIL' : 'NONE';
	let notificationStatus = 'SKIPPED';
	let notificationError = recipientEmail ? null : '이메일 정보가 없습니다.';

	if (recipientEmail) {
		const emailResult = await sendInquiryReplyEmail({
			to: recipientEmail,
			name: recipientName,
			inquiryTitle: inquiry.title,
			replyContent: answerContent,
		});
		notificationStatus = emailResult.status || (emailResult.ok ? 'SENT' : 'FAILED');
		notificationError = emailResult.error || null;
	}

	await db.execute(
		`UPDATE inquiries
       SET status = 'ANSWERED',
           answer_content = ?,
           answered_at = NOW(),
           notification_channel = ?,
           notification_status = ?,
           notification_error = ?
       WHERE id = ?`,
		[answerContent, notificationChannel, notificationStatus, notificationError, inquiryId],
	);

	return res.redirect('/admin/inquiries');
}));

module.exports = router;
