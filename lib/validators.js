// lib/validators.js
// 입력값 검증 공통 유틸
//
// 이 파일을 단일 진실의 원천으로 사용하고,
// routes/auth.js, routes/shop.js 등에서 import하여 재사용한다.

'use strict';

/**
 * RFC 5321/5322 기준 이메일 형식 검증 (실용적 서브셋)
 * - 로컬 파트: 알파벳·숫자·._%+- 허용
 * - 도메인: 알파벳·숫자·.- 허용
 * - TLD: 2자 이상 알파벳
 *
 * @param {string} email
 * @returns {boolean}
 */
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function isValidEmail(email) {
	if (typeof email !== 'string') return false;
	return EMAIL_REGEX.test(email.trim());
}

module.exports = { isValidEmail, EMAIL_REGEX };
