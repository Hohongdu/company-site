const test = require('node:test');
const assert = require('node:assert/strict');

const { createPapagoService } = require('../services/papago.service');

function resetPapagoEnv() {
	delete process.env.PAPAGO_CLIENT_ID;
	delete process.env.PAPAGO_CLIENT_SECRET;
	delete process.env.NAVER_CLIENT_ID;
	delete process.env.NAVER_CLIENT_SECRET;
}

test('PAPAGO_* 키는 NCP 엔드포인트/헤더로 호출한다', async () => {
	resetPapagoEnv();
	process.env.PAPAGO_CLIENT_ID = 'ncp-id';
	process.env.PAPAGO_CLIENT_SECRET = 'ncp-secret';

	const service = createPapagoService({
		post: async (url, body, config) => {
			assert.equal(url, 'https://naveropenapi.apigw.ntruss.com/nmt/v1/translation');
			assert.match(body, /text=hello/i);
			assert.equal(config.headers['X-NCP-APIGW-API-KEY-ID'], 'ncp-id');
			assert.equal(config.headers['X-NCP-APIGW-API-KEY'], 'ncp-secret');
			return {
				data: {
					message: {
						result: { translatedText: '안녕하세요', srcLangType: 'en', tarLangType: 'ko' },
					},
				},
			};
		},
	});

	const result = await service.translateText({ text: 'hello', source: 'en', target: 'ko' });
	assert.equal(result.translatedText, '안녕하세요');
});

test('NAVER_* 키는 OpenAPI 엔드포인트/헤더로 호출한다', async () => {
	resetPapagoEnv();
	process.env.NAVER_CLIENT_ID = 'naver-id';
	process.env.NAVER_CLIENT_SECRET = 'naver-secret';

	const service = createPapagoService({
		post: async (url, _body, config) => {
			assert.equal(url, 'https://openapi.naver.com/v1/papago/n2mt');
			assert.equal(config.headers['X-Naver-Client-Id'], 'naver-id');
			assert.equal(config.headers['X-Naver-Client-Secret'], 'naver-secret');
			return {
				data: {
					message: {
						result: { translatedText: 'テスト', srcLangType: 'ko', tarLangType: 'ja' },
					},
				},
			};
		},
	});

	const result = await service.translateText({ text: '테스트', target: 'ja' });
	assert.equal(result.translatedText, 'テスト');
});

test('target이 없으면 400 오류를 던진다', async () => {
	resetPapagoEnv();
	process.env.PAPAGO_CLIENT_ID = 'dummy-id';
	process.env.PAPAGO_CLIENT_SECRET = 'dummy-secret';
	const service = createPapagoService({ post: async () => ({}) });

	await assert.rejects(() => service.translateText({ text: 'hello' }), (err) => {
		assert.equal(err.status, 400);
		return true;
	});
});

test('인증정보가 없으면 500 오류를 던진다', async () => {
	resetPapagoEnv();
	const service = createPapagoService({ post: async () => ({}) });

	await assert.rejects(() => service.translateText({ text: 'hello', target: 'ko' }), (err) => {
		assert.equal(err.status, 500);
		return true;
	});
});

test('Papago 403은 원인 파악 가능한 메시지로 변환한다', async () => {
	resetPapagoEnv();
	process.env.NAVER_CLIENT_ID = 'id';
	process.env.NAVER_CLIENT_SECRET = 'secret';

	const service = createPapagoService({
		post: async () => {
			const err = new Error('Request failed with status code 403');
			err.response = { status: 403, data: { errorMessage: 'Forbidden' } };
			throw err;
		},
	});

	await assert.rejects(() => service.translateText({ text: '홈', target: 'en' }), (err) => {
		assert.equal(err.status, 502);
		assert.match(err.message, /provider=/);
		return true;
	});
});
