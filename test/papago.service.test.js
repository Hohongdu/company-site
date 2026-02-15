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
	assert.equal(result.providerUsed, 'ncp');
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
	assert.equal(result.providerUsed, 'naver-openapi');
});

test('양쪽 키세트가 있으면 primary 403 시 fallback provider로 재시도한다', async () => {
	resetPapagoEnv();
	process.env.PAPAGO_CLIENT_ID = 'key-id';
	process.env.PAPAGO_CLIENT_SECRET = 'key-secret';
	process.env.NAVER_CLIENT_ID = 'naver-id';
	process.env.NAVER_CLIENT_SECRET = 'naver-secret';

	const calls = [];
	const service = createPapagoService({
		post: async (url, _body, config) => {
			calls.push({ url, headers: config.headers });
			if (url.includes('apigw')) {
				const err = new Error('403');
				err.response = { status: 403, data: { errorMessage: 'forbidden primary' } };
				throw err;
			}
			return {
				data: {
					message: {
						result: { translatedText: 'Home', srcLangType: 'ko', tarLangType: 'en' },
					},
				},
			};
		},
	});

	const result = await service.translateText({ text: '홈', target: 'en' });
	assert.equal(result.translatedText, 'Home');
	assert.equal(result.providerUsed, 'naver-openapi');
	assert.equal(calls.length, 2);
});

test('양쪽 키세트가 있으면 primary 404 시 fallback provider로 재시도한다', async () => {
	resetPapagoEnv();
	process.env.PAPAGO_CLIENT_ID = 'key-id';
	process.env.PAPAGO_CLIENT_SECRET = 'key-secret';
	process.env.NAVER_CLIENT_ID = 'naver-id';
	process.env.NAVER_CLIENT_SECRET = 'naver-secret';

	const calls = [];
	const service = createPapagoService({
		post: async (url) => {
			calls.push(url);
			if (url.includes('apigw')) {
				const err = new Error('404');
				err.response = { status: 404, data: { errorMessage: 'not found primary' } };
				throw err;
			}
			return {
				data: {
					message: {
						result: { translatedText: 'Home', srcLangType: 'ko', tarLangType: 'en' },
					},
				},
			};
		},
	});

	const result = await service.translateText({ text: '홈', target: 'en' });
	assert.equal(result.providerUsed, 'naver-openapi');
	assert.equal(result.translatedText, 'Home');
	assert.equal(calls.length, 2);
});

test('단일 키세트일 때 403이면 cross-provider 재시도를 생략한다', async () => {
	resetPapagoEnv();
	process.env.NAVER_CLIENT_ID = 'naver-id';
	process.env.NAVER_CLIENT_SECRET = 'naver-secret';

	let callCount = 0;
	const service = createPapagoService({
		post: async () => {
			callCount += 1;
			const err = new Error('Request failed with status code 403');
			err.response = { status: 403, data: { errorMessage: 'Forbidden' } };
			throw err;
		},
	});

	await assert.rejects(() => service.translateText({ text: '홈', target: 'en' }), (err) => {
		assert.equal(err.status, 502);
		assert.match(err.message, /cross-provider 재시도를 생략/);
		return true;
	});

	assert.equal(callCount, 1);
});

test('양쪽 모두 403이면 502로 변환한다', async () => {
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
		assert.match(err.message, /인증\/엔드포인트 실패/);
		return true;
	});
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
