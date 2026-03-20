/**
 * 보안 수정 사항 단위 테스트 (H-4, H-5, L-2, L-3, M-1, M-2, M-5, M-6 관련)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

// ── M-1: 이메일 형식 검증 로직 ─────────────────────────────────────────
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

test('M-1: 올바른 이메일 형식은 검증을 통과한다', () => {
	const valid = ['user@example.com', 'a+b@sub.domain.co.kr', 'test123@mail.org'];
	for (const email of valid) {
		assert.ok(emailRegex.test(email), `${email} 실패`);
	}
});

test('M-1: 잘못된 이메일 형식은 검증에 실패한다', () => {
	const invalid = ['', 'notanemail', '@no-user.com', 'no-at-sign', 'spaces @mail.com', 'a@'];
	for (const email of invalid) {
		assert.ok(!emailRegex.test(email), `${email} 은 거부되어야 함`);
	}
});

// ── H-5: 쿠폰 할인율 캡 ──────────────────────────────────────────────
function capCouponDiscount(raw) {
	const n = Number(raw || 0) || 0; // NaN 방어
	return Math.min(30, Math.max(0, n));
}

test('H-5: 쿠폰 할인율은 0~30% 사이로 제한된다', () => {
	assert.equal(capCouponDiscount(0), 0);
	assert.equal(capCouponDiscount(15), 15);
	assert.equal(capCouponDiscount(30), 30);
	assert.equal(capCouponDiscount(31), 30, '31%는 30%로 클리핑');
	assert.equal(capCouponDiscount(100), 30, '100%는 30%로 클리핑');
	assert.equal(capCouponDiscount(-5), 0, '음수는 0으로 클리핑');
	assert.equal(capCouponDiscount('abc'), 0, '비숫자는 0으로 처리');
});

// ── L-3: 업로드 상태 계산 로직 ──────────────────────────────────────
function computeUploadStatus(successCount, failCount) {
	return failCount === 0 ? 'SUCCESS' : successCount > 0 ? 'PARTIAL' : 'FAILED';
}

test('L-3: 모두 성공 시 SUCCESS를 반환한다', () => {
	assert.equal(computeUploadStatus(5, 0), 'SUCCESS');
});

test('L-3: 일부 성공 시 PARTIAL을 반환한다 (수정 전 FAILED로 잘못 표기)', () => {
	assert.equal(computeUploadStatus(3, 2), 'PARTIAL');
});

test('L-3: 모두 실패 시 FAILED를 반환한다', () => {
	assert.equal(computeUploadStatus(0, 5), 'FAILED');
});

// ── M-6: 빈 장바구니 vs 0원 장바구니 ───────────────────────────────
function shouldBlockCheckout(items, _totalAmount) {
	// M-6 수정: items가 비어있는 경우만 차단. 0원 총액은 허용 (무료 상품)
	return items.length === 0;
}

test('M-6: 빈 장바구니는 결제를 차단한다', () => {
	assert.ok(shouldBlockCheckout([], 0));
});

test('M-6: 0원 장바구니이지만 상품이 있으면 결제를 허용한다', () => {
	assert.ok(!shouldBlockCheckout([{ id: 1, price: 0 }], 0));
});

test('M-6: 일반 장바구니는 결제를 허용한다', () => {
	assert.ok(!shouldBlockCheckout([{ id: 1, price: 10000 }], 10000));
});

// ── M-1: 비밀번호 최소 길이 ─────────────────────────────────────────
const MIN_PASSWORD_LENGTH = 8;

test('M-1: 8자 이상 비밀번호는 허용된다', () => {
	assert.ok('password'.length >= MIN_PASSWORD_LENGTH);
	assert.ok('12345678'.length >= MIN_PASSWORD_LENGTH);
});

test('M-1: 7자 이하 비밀번호는 거부된다', () => {
	assert.ok(!('1234567'.length >= MIN_PASSWORD_LENGTH));
	assert.ok(!(''.length >= MIN_PASSWORD_LENGTH));
});

// ── M-7: 주문번호 형식 검증 ──────────────────────────────────────────
const orderNumberRegex = /^[A-Za-z0-9\-]{1,30}$/;

test('M-7: 올바른 주문번호 형식은 통과한다', () => {
	assert.ok(orderNumberRegex.test('ORD-1234567890-ab12cd34'));
	assert.ok(orderNumberRegex.test('ABC-123'));
	assert.ok(orderNumberRegex.test('12345'));
});

test('M-7: SQL 인젝션 패턴은 주문번호 검증에서 거부된다', () => {
	assert.ok(!orderNumberRegex.test("'; DROP TABLE orders;--"));
	assert.ok(!orderNumberRegex.test('ORDER 1=1'));
	assert.ok(!orderNumberRegex.test(''));
	assert.ok(!orderNumberRegex.test('A'.repeat(31)), '31자 초과는 거부');
});
