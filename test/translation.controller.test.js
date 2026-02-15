const test = require('node:test');
const assert = require('node:assert/strict');

const controller = require('../controllers/translation.controller');

function mockRes() {
	const res = {
		statusCode: 200,
		payload: null,
		status(code) {
			this.statusCode = code;
			return this;
		},
		json(data) {
			this.payload = data;
			return this;
		},
	};
	return res;
}

test('status: 인증정보 없으면 안내 메시지를 반환한다', async () => {
	delete process.env.PAPAGO_CLIENT_ID;
	delete process.env.PAPAGO_CLIENT_SECRET;
	delete process.env.NAVER_CLIENT_ID;
	delete process.env.NAVER_CLIENT_SECRET;

	const req = { query: {} };
	const res = mockRes();
	await controller.status(req, res);

	assert.equal(res.statusCode, 200);
	assert.equal(res.payload.ok, false);
	assert.equal(res.payload.hasCredentials, false);
	assert.match(res.payload.providerNote, /자동 선택/);
});

test('status: 인증정보가 있으면 provider 정보를 반환한다', async () => {
	process.env.PAPAGO_CLIENT_ID = 'id';
	process.env.PAPAGO_CLIENT_SECRET = 'secret';
	delete process.env.NAVER_CLIENT_ID;
	delete process.env.NAVER_CLIENT_SECRET;

	const req = { query: {} };
	const res = mockRes();
	await controller.status(req, res);

	assert.equal(res.statusCode, 200);
	assert.equal(res.payload.ok, true);
	assert.equal(res.payload.provider, 'ncp');
	assert.equal(res.payload.envState.hasPapagoPair, true);
});
