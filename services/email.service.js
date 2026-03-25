// services/email.service.js
// 이메일 발송 서비스
// 우선순위: NCP Cloud Outbound Mailer → Gmail SMTP fallback
// NCP: .env에 NCP_ACCESS_KEY, NCP_SECRET_KEY, NCP_MAIL_FROM 설정 필요
// SMTP: .env에 SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM 설정 필요

'use strict';

const crypto = require('crypto');
const https  = require('https');
const nodemailer = require('nodemailer');

// ── NCP Cloud Outbound Mailer 설정 ────────────────────
const NCP_ACCESS_KEY = process.env.NCP_ACCESS_KEY || '';
const NCP_SECRET_KEY = process.env.NCP_SECRET_KEY || '';
const NCP_MAIL_FROM  = process.env.NCP_MAIL_FROM  || process.env.EMAIL_FROM || '';
const NCP_API_HOST   = 'mail.apigw.ntruss.com';
const NCP_API_PATH   = '/api/v1/mails';

const isNcpConfigured = () => Boolean(NCP_ACCESS_KEY && NCP_SECRET_KEY && NCP_MAIL_FROM);

/**
 * NCP HMAC-SHA256 서명 생성
 */
function makeNcpSignature(timestamp) {
	const message = `POST ${NCP_API_PATH}\n${timestamp}\n${NCP_ACCESS_KEY}`;
	return crypto.createHmac('sha256', NCP_SECRET_KEY).update(message).digest('base64');
}

/**
 * NCP Cloud Outbound Mailer API 호출
 */
async function sendViaNcp({ to, subject, html, text }) {
	const timestamp = String(Date.now());
	const signature = makeNcpSignature(timestamp);

	const body = JSON.stringify({
		senderAddress: NCP_MAIL_FROM,
		senderName:    'ENERMADE',
		title:         subject,
		body:          html,
		recipients: [{ address: to, type: 'R' }],
		individual:    true,
		advertising:   false,
	});

	return new Promise((resolve, reject) => {
		const req = https.request({
			hostname: NCP_API_HOST,
			path:     NCP_API_PATH,
			method:   'POST',
			headers: {
				'Content-Type':             'application/json',
				'x-ncp-apigw-timestamp':    timestamp,
				'x-ncp-iam-access-key':     NCP_ACCESS_KEY,
				'x-ncp-apigw-signature-v2': signature,
			},
		}, (res) => {
			let data = '';
			res.on('data', chunk => { data += chunk; });
			res.on('end', () => {
				if (res.statusCode >= 200 && res.statusCode < 300) {
					const parsed = JSON.parse(data || '{}');
					resolve({ ok: true, status: 'SENT', messageId: parsed.requestId || parsed.mailId });
				} else {
					reject(new Error(`NCP API ${res.statusCode}: ${data}`));
				}
			});
		});
		req.on('error', reject);
		req.write(body);
		req.end();
	});
}

// ── Gmail SMTP 설정 ───────────────────────────────────
const SMTP_HOST  = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT  = Number(process.env.SMTP_PORT || 587);
const SMTP_USER  = process.env.SMTP_USER || '';
const SMTP_PASS  = process.env.SMTP_PASS || '';
const EMAIL_FROM = process.env.EMAIL_FROM || SMTP_USER || 'no-reply@example.com';

const isSmtpConfigured = () => Boolean(SMTP_USER && SMTP_PASS);

let _transporter = null;
function getTransporter() {
	if (!_transporter) {
		_transporter = nodemailer.createTransport({
			host:   SMTP_HOST,
			port:   SMTP_PORT,
			secure: SMTP_PORT === 465,
			auth:   { user: SMTP_USER, pass: SMTP_PASS },
		});
	}
	return _transporter;
}

async function sendViaSmtp({ to, subject, html, text }) {
	const info = await getTransporter().sendMail({
		from:    `"ENERMADE" <${EMAIL_FROM}>`,
		to,
		subject,
		html,
		text: text || html.replace(/<[^>]+>/g, ''),
	});
	return { ok: true, status: 'SENT', messageId: info.messageId };
}

// ── 공통 isConfigured ─────────────────────────────────
const isConfigured = () => isNcpConfigured() || isSmtpConfigured();

/**
 * 이메일 발송 (NCP 우선 → SMTP fallback)
 * @param {{ to: string, subject: string, html: string, text?: string }} opts
 * @returns {Promise<{ ok: boolean, status: string, messageId?: string, error?: string }>}
 */
async function sendMail({ to, subject, html, text }) {
	if (!isConfigured()) {
		console.warn('[email] No mail provider configured. Skipping send.');
		return { ok: false, status: 'DISABLED', error: '이메일 설정이 없습니다.' };
	}

	if (isNcpConfigured()) {
		try {
			const result = await sendViaNcp({ to, subject, html, text });
			console.log(`[email/ncp] Sent to ${to}: ${result.messageId}`);
			return result;
		} catch (err) {
			console.warn(`[email/ncp] Failed (${err.message}), falling back to SMTP`);
		}
	}

	if (isSmtpConfigured()) {
		try {
			const result = await sendViaSmtp({ to, subject, html, text });
			console.log(`[email/smtp] Sent to ${to}: ${result.messageId}`);
			return result;
		} catch (err) {
			console.error('[email/smtp] Send failed:', err.message);
			return { ok: false, status: 'FAILED', error: String(err.message || err) };
		}
	}

	return { ok: false, status: 'FAILED', error: '사용 가능한 이메일 제공자가 없습니다.' };
}

module.exports = { sendMail, isConfigured, isNcpConfigured, isSmtpConfigured };
