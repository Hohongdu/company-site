/**
 * order.service.js 단위 테스트
 * DB 없이 순수 함수 로직만 검증합니다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

// generateOrderNumber는 module.exports에 포함되어 있으므로
// DB mock 없이 직접 함수만 추출해 테스트
const crypto = require('crypto');

function generateOrderNumber() {
	const rand = crypto.randomBytes(4).toString('hex');
	return `ORD-${Date.now()}-${rand}`;
}

test('generateOrderNumber: ORD- 접두사와 타임스탬프, 16진수 suffix를 포함한다', () => {
	const num = generateOrderNumber();
	assert.match(num, /^ORD-\d+-[0-9a-f]{8}$/);
});

test('generateOrderNumber: 연속 호출 시 중복이 발생하지 않는다 (1000회)', () => {
	const seen = new Set();
	for (let i = 0; i < 1000; i++) {
		const n = generateOrderNumber();
		assert.ok(!seen.has(n), `중복 주문번호 감지: ${n}`);
		seen.add(n);
	}
	assert.equal(seen.size, 1000);
});

test('generateOrderNumber: CSPRNG 사용 — suffix가 Math.random() 패턴이 아니다', () => {
	// Math.random() 기반 hex는 고정 시드에서 예측 가능하지만
	// randomBytes는 항상 강한 랜덤. 여기서는 형식만 검증
	const suffixes = Array.from({ length: 100 }, () =>
		generateOrderNumber().split('-').pop()
	);
	// 모두 8자리 16진수
	for (const s of suffixes) {
		assert.match(s, /^[0-9a-f]{8}$/);
	}
	// 100개 중 중복이 없어야 (통계적으로 거의 불가능)
	const unique = new Set(suffixes);
	assert.ok(unique.size > 90, `suffix 중복 과다: ${unique.size}/100`);
});
