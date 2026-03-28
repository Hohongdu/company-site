// services/smtp-email.service.js
// Gmail / 일반 SMTP를 통한 이메일 발송 (nodemailer)
// 설정: .env에 SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM 설정 필요

'use strict';

const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const EMAIL_FROM = process.env.EMAIL_FROM || SMTP_USER || 'no-reply@example.com';

function isConfigured() {
	return Boolean(SMTP_USER && SMTP_PASS);
}

let _transporter = null;
function getTransporter() {
	if (!_transporter) {
		_transporter = nodemailer.createTransport({
			host: SMTP_HOST,
			port: SMTP_PORT,
			secure: SMTP_PORT === 465,
			auth: { user: SMTP_USER, pass: SMTP_PASS },
		});
	}
	return _transporter;
}

/**
 * @param {{ to: string, subject: string, html: string, text?: string }} opts
 * @returns {Promise<{ ok: boolean, status: string, messageId?: string, error?: string }>}
 */
async function sendMail({ to, subject, html, text }) {
	if (!isConfigured()) {
		console.warn('[smtp-email] SMTP not configured (SMTP_USER/SMTP_PASS missing). Skipping send.');
		return { ok: false, status: 'DISABLED', error: 'SMTP 설정이 없습니다.' };
	}

	try {
		const info = await getTransporter().sendMail({
			from: `"ENERMADE" <${EMAIL_FROM}>`,
			to,
			subject,
			html,
			text: text || html.replace(/<[^>]+>/g, ''),
		});

		console.log(`[smtp-email] Sent to ${to}: ${info.messageId}`);
		return { ok: true, status: 'SENT', messageId: info.messageId };
	} catch (err) {
		console.error('[smtp-email] Send failed:', err.message);
		return { ok: false, status: 'FAILED', error: String(err.message || err) };
	}
}

module.exports = { sendMail, isConfigured };
