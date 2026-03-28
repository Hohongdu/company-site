// services/email.service.js
// 이메일 드라이버 라우터 — EMAIL_DRIVER 환경변수에 따라 백엔드를 선택한다.
//
//   EMAIL_DRIVER=smtp  → services/smtp-email.service.js (Gmail / 일반 SMTP, 기본값)
//   EMAIL_DRIVER=ncp   → services/ncp-email.service.js  (NCP Outbound Mailer REST API)
//   EMAIL_DRIVER=none  → 발송 비활성화 (개발/테스트 환경)
//
// 모든 소비자(notification.service 등)는 이 파일만 import하면 된다.

'use strict';

const DRIVER = (process.env.EMAIL_DRIVER || 'smtp').toLowerCase();

let _driver;

switch (DRIVER) {
	case 'ncp':
		_driver = require('./ncp-email.service');
		console.log('[email] Driver: NCP Outbound Mailer');
		break;

	case 'none':
		_driver = {
			sendMail: async ({ to, subject }) => {
				console.log(`[email] Driver=none, skipping send to ${to} | subject: ${subject}`);
				return { ok: false, status: 'DISABLED', error: 'EMAIL_DRIVER=none' };
			},
			isConfigured: () => false,
		};
		console.log('[email] Driver: none (발송 비활성화)');
		break;

	case 'smtp':
	default:
		_driver = require('./smtp-email.service');
		console.log('[email] Driver: SMTP');
		break;
}

/**
 * 이메일 발송 (드라이버에 위임)
 * @param {{ to: string, subject: string, html: string, text?: string }} opts
 * @returns {Promise<{ ok: boolean, status: string, messageId?: string, error?: string }>}
 */
async function sendMail(opts) {
	return _driver.sendMail(opts);
}

/**
 * 현재 드라이버가 올바르게 설정되어 있는지 여부
 * @returns {boolean}
 */
function isConfigured() {
	return _driver.isConfigured();
}

/**
 * 현재 활성 드라이버 이름 반환 (관리자 테스트용)
 * @returns {string}
 */
function getDriverName() {
	return DRIVER;
}

module.exports = { sendMail, isConfigured, getDriverName };
