// services/smtp-email.service.js
// Gmail / 일반 SMTP를 통한 이메일 발송 (nodemailer)
// 설정: .env에 SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM 설정 필요

'use strict';

const nodemailer = require('nodemailer');

/**
 * 이메일 주소 마스킹: user@domain.com → u***@domain.com
 * 민감정보 로그 노출 방지용
 * @param {string} email
 * @returns {string}
 */
function maskEmail(email) {
	if (typeof email !== 'string') return '[unknown]';
	const [local, domain] = email.split('@');
	if (!local || !domain) return '[invalid]';
	const masked = local.length <= 1 ? '*' : `${local[0]}${'*'.repeat(Math.min(local.length - 1, 3))}`;
	return `${masked}@${domain}`;
}

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

function plainTextFromHtml(html) {
	const parts = [];
	let cursor = 0;
	while (cursor < html.length) {
		const open = html.indexOf('<', cursor);
		if (open === -1) break;
		const close = html.indexOf('>', open + 1);
		if (close === -1) break;

		// Keep empty angle brackets as text, matching the previous fallback.
		parts.push(html.slice(cursor, close === open + 1 ? close + 1 : open));
		cursor = close + 1;
	}
	parts.push(html.slice(cursor));
	return parts.join('');
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

	const maskedTo = maskEmail(to);
	try {
		const info = await getTransporter().sendMail({
			from: `"ENERMADE" <${EMAIL_FROM}>`,
			to,
			subject,
			html,
			text: text || plainTextFromHtml(html),
		});

		console.log(`[smtp-email] ${new Date().toISOString()} Sent to ${maskedTo} | subject: ${subject} | messageId: ${info.messageId}`);
		return { ok: true, status: 'SENT', messageId: info.messageId };
	} catch (err) {
		console.error(`[smtp-email] ${new Date().toISOString()} Send FAILED to ${maskedTo} | subject: ${subject} | error: ${err.message}`);
		return { ok: false, status: 'FAILED', error: String(err.message || err) };
	}
}

/**
 * HTML 특수문자 이스케이프 (이메일 본문 인젝션 방지)
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#x27;');
}

/**
 * 관리자에게 서버 오류 알림 이메일 발송
 * @param {{ error: string, url: string, method: string, userId?: number|null, stack?: string }} opts
 */
async function sendAdminErrorAlert({ error, url, method, userId, stack }) {
	const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_FROM;
	if (!adminEmail) return;
	// [M-7] 이메일 HTML 인젝션 방지: user-controlled 값 이스케이프 처리
	const safeMethod = escapeHtml(method || '');
	const safeUrl = escapeHtml(url || '');
	const safeUserId = escapeHtml(userId || '비회원');
	const safeError = escapeHtml(String(error));
	const safeStack = escapeHtml((stack || '').slice(0, 2000));
	const subject = `[ENERMADE] 서버 오류 발생 — ${safeMethod} ${safeUrl}`;
	const html = `<h3>서버 오류 알림</h3>
    <table>
      <tr><th>시간</th><td>${new Date().toISOString()}</td></tr>
      <tr><th>URL</th><td>${safeMethod} ${safeUrl}</td></tr>
      <tr><th>사용자</th><td>${safeUserId}</td></tr>
      <tr><th>오류</th><td>${safeError}</td></tr>
      <tr><th>스택</th><td><pre>${safeStack}</pre></td></tr>
    </table>`;
	return sendMail({ to: adminEmail, subject, html }).catch(() => {});
}

module.exports = { sendMail, isConfigured, sendAdminErrorAlert };
