// 회원가입 동의 검증 회귀 테스트
// 개인정보 보호법 제15조 (구분 동의)가 코드 변경으로 우회되지 않도록 보장
//
// 핵심 보장 사항:
// 1. 약관/개인정보 미동의 시 회원가입이 거부되어야 한다
// 2. 마케팅(선택) 미동의는 회원가입을 막으면 안 된다
// 3. 회원가입 폼에 모든 동의 체크박스가 렌더링되어야 한다

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REGISTER_VIEW = path.join(__dirname, '..', 'views', 'auth', 'register.ejs');
const AUTH_ROUTE = path.join(__dirname, '..', 'routes', 'auth.js');

test('register.ejs: 필수 동의 체크박스(agreeTerms, agreePrivacy)와 선택(agreeMarketing) 렌더링', () => {
	const html = fs.readFileSync(REGISTER_VIEW, 'utf8');
	assert.match(html, /name="agreeTerms"/, 'agreeTerms 체크박스가 폼에 있어야 함');
	assert.match(html, /name="agreePrivacy"/, 'agreePrivacy 체크박스가 폼에 있어야 함');
	assert.match(html, /name="agreeMarketing"/, 'agreeMarketing 체크박스가 폼에 있어야 함');
	assert.match(html, /href="\/terms"/, '약관 페이지 링크가 있어야 함');
	assert.match(html, /href="\/privacy"/, '개인정보처리방침 페이지 링크가 있어야 함');
});

test('routes/auth.js: agreeTerms 미동의 시 회원가입 거부 검증 코드 존재', () => {
	const src = fs.readFileSync(AUTH_ROUTE, 'utf8');
	assert.match(
		src,
		/agreeTerms\s*!==\s*['"]1['"]/,
		'agreeTerms !== "1" 검증이 있어야 함 (필수 동의)',
	);
});

test('routes/auth.js: agreePrivacy 미동의 시 회원가입 거부 검증 코드 존재', () => {
	const src = fs.readFileSync(AUTH_ROUTE, 'utf8');
	assert.match(
		src,
		/agreePrivacy\s*!==\s*['"]1['"]/,
		'agreePrivacy !== "1" 검증이 있어야 함 (필수 동의)',
	);
});

test('routes/auth.js: agreeMarketing은 falsy 거부가 없어야 한다 (선택 동의)', () => {
	const src = fs.readFileSync(AUTH_ROUTE, 'utf8');
	// agreeMarketing !== '1' 처럼 거부하는 패턴이 없어야 함
	assert.doesNotMatch(
		src,
		/agreeMarketing\s*!==\s*['"]1['"]/,
		'agreeMarketing은 미체크해도 가입 허용되어야 함',
	);
});

test('routes/auth.js: 동의 시각/IP/UA 기록 INSERT 코드 존재', () => {
	const src = fs.readFileSync(AUTH_ROUTE, 'utf8');
	assert.match(src, /terms_agreed_at/, 'terms_agreed_at 컬럼 기록');
	assert.match(src, /privacy_agreed_at/, 'privacy_agreed_at 컬럼 기록');
	assert.match(src, /consent_ip/, 'consent_ip 컬럼 기록 (분쟁 증거)');
});

test('routes/auth.js: ensureUserConsentColumns 마이그레이션 함수 존재', () => {
	const src = fs.readFileSync(AUTH_ROUTE, 'utf8');
	assert.match(src, /ensureUserConsentColumns/, '컬럼 자동 추가 함수 정의');
	assert.match(src, /router\.initializeSchema/, 'initializeSchema 노출 (app.js가 호출)');
});
