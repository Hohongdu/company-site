const test = require('node:test');
const assert = require('node:assert/strict');

const { createPapagoService } = require('../services/papago.service');

function resetPapagoEnv() {
	delete process.env.PAPAGO_CLIENT_ID;
	delete process.env.PAPAGO_CLIENT_SECRET;
	delete process.env.NAVER_CLIENT_ID;
	delete process.env.NAVER_CLIENT_SECRET;
}

test('Papago 서비스가 번역 결과를 정상 반환한다', async () => {
	resetPapagoEnv();
	process.env.PAPAGO_CLIENT_ID = 'dummy-id';
	process.env.PAPAGO_CLIENT_SECRET = 'dummy-secret';

	const fakeClient = {
		post: async (_url, body) => {
			assert.match(body, /text=hello/i);
			return {
				data: {
					message: {
						result: {
							translatedText: '안녕하세요',
							srcLangType: 'en',
							tarLangType: 'ko',
						},
					},
				},
			};
		},
	};

	const service = createPapagoService(fakeClient);
	const result = await service.translateText({ text: 'hello', source: 'en', target: 'ko' });

	assert.equal(result.translatedText, '안녕하세요');
	assert.equal(result.sourceLang, 'en');
	assert.equal(result.targetLang, 'ko');
});

test('target이 없으면 400 오류를 던진다', async () => {
	resetPapagoEnv();
	process.env.PAPAGO_CLIENT_ID = 'dummy-id';
	process.env.PAPAGO_CLIENT_SECRET = 'dummy-secret';

	const service = createPapagoService({ post: async () => ({}) });

	await assert.rejects(() => service.translateText({ text: 'hello' }), (err) => {
		assert.equal(err.status, 400);
		assert.match(err.message, /target/);
		return true;
	});
});

test('PAPAGO_*가 없으면 NAVER_* 환경변수로도 동작한다', async () => {
	resetPapagoEnv();
	process.env.NAVER_CLIENT_ID = 'dummy-id';
	process.env.NAVER_CLIENT_SECRET = 'dummy-secret';

	const service = createPapagoService({
		post: async () => ({
			data: {
				message: {
					result: {
						translatedText: '테스트',
						srcLangType: 'en',
						tarLangType: 'ko',
					},
				},
			},
		}),
	});

	const result = await service.translateText({ text: 'test', target: 'ko' });
	assert.equal(result.translatedText, '테스트');
});

test('인증정보가 없으면 500 오류를 던진다', async () => {
	resetPapagoEnv();
	const service = createPapagoService({ post: async () => ({}) });

	await assert.rejects(() => service.translateText({ text: 'hello', target: 'ko' }), (err) => {
		assert.equal(err.status, 500);
		assert.match(err.message, /\.env/);
		return true;
	});
});
