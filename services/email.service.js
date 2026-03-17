// services/email.service.js
// Gmail SMTP를 통한 이메일 발송 서비스
// 설정: .env에 SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM 설정 필요

'use strict';

const nodemailer = require('nodemailer');

// ── 설정 ──────────────────────────────────────────────
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const EMAIL_FROM = process.env.EMAIL_FROM || SMTP_USER || 'no-reply@example.com';

// SMTP 설정이 있는지 여부
const isConfigured = () => Boolean(SMTP_USER && SMTP_PASS);

// Transporter: 설정이 있을 때만 생성
let _transporter = null;
function getTransporter() {
	if (!_transporter) {
		_transporter = nodemailer.createTransport({
			host: SMTP_HOST,
			port: SMTP_PORT,
			secure: SMTP_PORT === 465, // 465는 SSL, 587은 STARTTLS
			auth: {
				user: SMTP_USER,
				pass: SMTP_PASS,
			},
		});
	}
	return _transporter;
}

/**
 * 이메일 발송
 * @param {{ to: string, subject: string, html: string, text?: string }} opts
 * @returns {Promise<{ ok: boolean, messageId?: string, error?: string }>}
 */
async function sendMail({ to, subject, html, text }) {
	if (!isConfigured()) {
		console.warn('[email] SMTP not configured (SMTP_USER/SMTP_PASS missing). Skipping send.');
		return { ok: false, status: 'DISABLED', error: 'SMTP 설정이 없습니다.' };
	}

	try {
		const info = await getTransporter().sendMail({
			from: `"ENERMADE" <${EMAIL_FROM}>`,
			to,
			subject,
			html,
			text: text || html.replace(/<[^>]+>/g, ''), // HTML 태그 제거한 텍스트 fallback
		});

		console.log(`[email] Sent to ${to}: ${info.messageId}`);
		return { ok: true, status: 'SENT', messageId: info.messageId };
	} catch (err) {
		console.error('[email] Send failed:', err.message);
		return { ok: false, status: 'FAILED', error: String(err.message || err) };
	}
}

module.exports = { sendMail, isConfigured };
