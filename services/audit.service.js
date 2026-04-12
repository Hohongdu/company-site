// services/audit.service.js
// 관리자 감사 로그 서비스
//
// 요구사항:
//   - admin_activity_logs 테이블 자동 생성 (서버 시작 시 한 번)
//   - logAdminAction(req, action, resourceType, resourceId, success, detail) 공통 함수
//   - 민감정보(비밀번호, 카드번호 등) detail에서 제외
//   - 로그 실패가 핵심 로직을 방해하지 않도록 .catch(() => {}) 처리

'use strict';

const db = require('../db');

/**
 * admin_activity_logs 테이블 자동 생성 (없으면 CREATE)
 * app.js startServer() 에서 1회 호출
 */
async function ensureAdminActivityLogTable() {
	await db.execute(`
		CREATE TABLE IF NOT EXISTS admin_activity_logs (
			id          BIGINT AUTO_INCREMENT PRIMARY KEY,
			admin_id    BIGINT NULL,
			action      VARCHAR(80)  NOT NULL,
			resource_type VARCHAR(50) NULL,
			resource_id   VARCHAR(100) NULL,
			ip          VARCHAR(45)  NULL,
			user_agent  VARCHAR(500) NULL,
			success     TINYINT(1)   NOT NULL DEFAULT 1,
			detail      JSON         NULL,
			created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
			INDEX idx_admin_id   (admin_id),
			INDEX idx_action     (action),
			INDEX idx_created_at (created_at)
		)
	`);
}

/**
 * 민감 키 필터링 — detail 객체에서 비밀번호·카드번호 등 제거
 * @param {Object|null} detail
 * @returns {Object|null}
 */
function sanitizeDetail(detail) {
	if (!detail || typeof detail !== 'object') return detail;

	const SENSITIVE_KEYS = new Set([
		'password', 'passwd', 'pw', 'secret', 'token',
		'card_number', 'cardNumber', 'cvv', 'cvc',
		'credit_card', 'creditCard', 'ssn',
	]);

	const result = {};
	for (const [key, value] of Object.entries(detail)) {
		if (SENSITIVE_KEYS.has(key.toLowerCase())) {
			result[key] = '[REDACTED]';
		} else if (value && typeof value === 'object' && !Array.isArray(value)) {
			result[key] = sanitizeDetail(value);
		} else {
			result[key] = value;
		}
	}
	return result;
}

/**
 * 관리자 액션 감사 로그 기록
 *
 * @param {import('express').Request} req         - Express 요청 객체 (IP, user-agent 추출용)
 * @param {string}  action                         - 액션명 (예: 'product_create', 'order_status_update')
 * @param {string}  [resourceType]                 - 리소스 종류 (예: 'product', 'order', 'notice', 'inquiry')
 * @param {string|number|null} [resourceId]        - 리소스 ID
 * @param {boolean} [success=true]                 - 성공 여부
 * @param {Object|null} [detail]                   - 추가 정보 (민감정보 자동 필터링)
 * @returns {Promise<void>}  — 실패해도 핵심 로직에 영향 없음
 */
async function logAdminAction(req, action, resourceType = null, resourceId = null, success = true, detail = null) {
	try {
		const adminId = req?.session?.user?.id || null;
		// X-Forwarded-For 헤더 우선, 없으면 remoteAddress
		const ip = (
			(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim() ||
			req?.socket?.remoteAddress ||
			null
		);
		const userAgent = req?.headers?.['user-agent']
			? String(req.headers['user-agent']).slice(0, 500)
			: null;

		const safeDetail = sanitizeDetail(detail);

		await db.execute(
			`INSERT INTO admin_activity_logs
				(admin_id, action, resource_type, resource_id, ip, user_agent, success, detail)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				adminId,
				String(action).slice(0, 80),
				resourceType ? String(resourceType).slice(0, 50) : null,
				resourceId !== null && resourceId !== undefined ? String(resourceId).slice(0, 100) : null,
				ip,
				userAgent,
				success ? 1 : 0,
				safeDetail ? JSON.stringify(safeDetail) : null,
			],
		);
	} catch (err) {
		// 로그 실패는 핵심 로직을 막지 않음
		console.error('[audit] logAdminAction failed:', err.message);
	}
}

module.exports = { ensureAdminActivityLogTable, logAdminAction };
