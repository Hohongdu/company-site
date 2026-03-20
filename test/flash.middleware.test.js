/**
 * lib/flash.js 미들웨어 단위 테스트
 * req/res/session을 직접 mock하여 HTTP 서버 없이 테스트합니다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const flash = require('../lib/flash');

function makeReqRes(sessionFlash = {}, query = {}) {
	const req = {
		session: { _flash: { ...sessionFlash } },
		query,
		flash: null, // 미들웨어가 주입
	};
	const res = { locals: {} };
	return { req, res };
}

test('flash: 세션의 _flash 메시지가 res.locals.flash에 노출된다', (t, done) => {
	const { req, res } = makeReqRes({ success: '저장 완료' });
	flash(req, res, () => {
		assert.equal(res.locals.flash.success, '저장 완료');
		done();
	});
});

test('flash: 미들웨어 실행 후 세션 _flash가 초기화된다', (t, done) => {
	const { req, res } = makeReqRes({ success: '저장 완료' });
	flash(req, res, () => {
		assert.deepEqual(req.session._flash, {});
		done();
	});
});

test('flash: req.flash()로 새 메시지를 세션에 저장한다', (t, done) => {
	const { req, res } = makeReqRes();
	flash(req, res, () => {
		req.flash('error', '오류 발생');
		assert.equal(req.session._flash.error, '오류 발생');
		done();
	});
});

test('flash: ?notice= 쿼리파라미터가 flash.success로 흡수된다', (t, done) => {
	const { req, res } = makeReqRes({}, { notice: '성공' });
	flash(req, res, () => {
		assert.equal(res.locals.flash.success, '성공');
		done();
	});
});

test('flash: ?error= 쿼리파라미터가 flash.error로 흡수된다', (t, done) => {
	const { req, res } = makeReqRes({}, { error: '오류입니다' });
	flash(req, res, () => {
		assert.equal(res.locals.flash.error, '오류입니다');
		done();
	});
});

test('flash: 세션에 flash가 이미 있으면 ?notice= 쿼리파라미터를 무시한다', (t, done) => {
	const { req, res } = makeReqRes({ success: '세션메시지' }, { notice: '쿼리메시지' });
	flash(req, res, () => {
		assert.equal(res.locals.flash.success, '세션메시지');
		done();
	});
});
