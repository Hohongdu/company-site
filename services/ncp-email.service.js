// services/ncp-email.service.js
// Naver Cloud Platform (NCP) Outbound Mailer REST API 연동
// 참고: https://api.ncloud-docs.com/docs/ai-application-service-cloudoutboundmailer
//
// 필요 환경변수:
//   NCP_EMAIL_ACCESS_KEY   – IAM 액세스 키
//   NCP_EMAIL_SECRET_KEY   – IAM 시크릿 키
//   NCP_EMAIL_SENDER       – 발신자 이메일 (NCP에 등록된 주소)
//   NCP_EMAIL_SENDER_NAME  – 발신자 이름 (기본값: ENERMADE)

'use strict';

const crypto = require('crypto');
const https = require('https');

const NCP_API_HOST = 'mail.apigw.ntruss.com';
const NCP_MAIL_PATH = '/api/v1/mails';

const ACCESS_KEY = process.env.NCP_EMAIL_ACCESS_KEY || '';
const SECRET_KEY = process.env.NCP_EMAIL_SECRET_KEY || '';
const SENDER = process.env.NCP_EMAIL_SENDER || '';
const SENDER_NAME = process.env.NCP_EMAIL_SENDER_NAME || 'ENERMADE';

// ── 설정 여부 확인 ────────────────────────────────────────────
function isConfigured() {
	return Boolean(ACCESS_KEY && SECRET_KEY && SENDER);
}

/**
 * 이메일 주소 마스킹: user@domain.com → u***@domain.com
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

// ── HMAC-SHA256 서명 생성 ─────────────────────────────────────
// NCP API GW v2 서명 규칙:
//   message = "{HTTP_METHOD}\n{URL_PATH}\n{TIMESTAMP}\n{ACCESS_KEY}"
//   signature = Base64(HMAC-SHA256(message, SECRET_KEY))
function makeSignature(method, urlPath, timestamp) {
	const message = `${method}\n${urlPath}\n${timestamp}\n${ACCESS_KEY}`;
	return crypto.createHmac('sha256', SECRET_KEY).update(message).digest('base64');
}

// ── 공통 헤더 생성 ────────────────────────────────────────────
function makeHeaders(bodyLength) {
	const timestamp = String(Date.now());
	const signature = makeSignature('POST', NCP_MAIL_PATH, timestamp);
	return {
		'Content-Type': 'application/json',
		'x-ncp-apigw-timestamp': timestamp,
		'x-ncp-iam-access-key': ACCESS_KEY,
		'x-ncp-apigw-signature-v2': signature,
		'Content-Length': String(bodyLength),
	};
}

// ── HTTPS POST 헬퍼 ──────────────────────────────────────────
function httpsPost(host, path, headers, body) {
	return new Promise((resolve, reject) => {
		const req = https.request({ hostname: host, path, method: 'POST', headers }, (res) => {
			let data = '';
			res.on('data', (chunk) => (data += chunk));
			res.on('end', () => {
				try {
					resolve({ status: res.statusCode, data: JSON.parse(data) });
				} catch {
					resolve({ status: res.statusCode, data });
				}
			});
		});
		req.on('error', reject);
		req.write(body);
		req.end();
	});
}

// ── 메인: 메일 발송 ───────────────────────────────────────────
/**
 * @param {{ to: string, subject: string, html: string, text?: string }} opts
 * @returns {Promise<{ ok: boolean, status: string, messageId?: string, error?: string }>}
 */
async function sendMail({ to, subject, html, text }) {
	if (!isConfigured()) {
		console.warn('[ncp-email] NCP 메일 설정 없음 (NCP_EMAIL_ACCESS_KEY/SECRET_KEY/SENDER). Skipping.');
		return { ok: false, status: 'DISABLED', error: 'NCP 메일 설정이 없습니다.' };
	}

	const payload = JSON.stringify({
		senderAddress: SENDER,
		senderName: SENDER_NAME,
		title: subject,
		body: html,
		recipients: [
			{
				address: to,
				name: '',
				type: 'R', // R=수신, C=참조, B=숨은참조
			},
		],
		individual: true,       // 개인별 발송 (수신자 목록 노출 방지)
		advertising: false,     // 광고 메일 여부
	});

	const maskedTo = maskEmail(to);
	try {
		const headers = makeHeaders(Buffer.byteLength(payload));
		const { status, data } = await httpsPost(NCP_API_HOST, NCP_MAIL_PATH, headers, payload);

		if (status === 201 || status === 200) {
			const messageId = data?.requestId || data?.mailId || String(status);
			console.log(`[ncp-email] ${new Date().toISOString()} Sent to ${maskedTo} | subject: ${subject} | requestId: ${messageId}`);
			return { ok: true, status: 'SENT', messageId };
		}

		const errMsg = data?.message || data?.error || `HTTP ${status}`;
		console.error(`[ncp-email] ${new Date().toISOString()} API error ${status} to ${maskedTo} | subject: ${subject} | error:`, data);
		return { ok: false, status: 'FAILED', error: errMsg };
	} catch (err) {
		console.error(`[ncp-email] ${new Date().toISOString()} Send FAILED to ${maskedTo} | subject: ${subject} | error: ${err.message}`);
		return { ok: false, status: 'FAILED', error: String(err.message || err) };
	}
}

module.exports = { sendMail, isConfigured };
