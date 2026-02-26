const test = require('node:test');
const assert = require('node:assert/strict');

const { createAiChatService } = require('../services/ai-chat.service');

function resetAiEnv() {
	delete process.env.AI_SERVER_BASE_URL;
	delete process.env.AI_MODEL;
	delete process.env.AI_GENERATE_PATH;
}

test('AI 서비스는 기본 Ollama 엔드포인트로 호출한다', async () => {
	resetAiEnv();

	const service = createAiChatService({
		post: async (url, body) => {
			assert.equal(url, 'http://127.0.0.1:11434/api/generate');
			assert.equal(body.model, 'llama3.2:1b');
			assert.equal(body.prompt, '안녕?');
			assert.equal(body.stream, false);
			return { data: { model: 'llama3.2:1b', response: '안녕하세요!' } };
		},
	});

	const result = await service.chat({ prompt: '안녕?' });
	assert.equal(result.response, '안녕하세요!');
	assert.equal(result.model, 'llama3.2:1b');
});

test('prompt가 없으면 400 오류를 반환한다', async () => {
	resetAiEnv();
	const service = createAiChatService({ post: async () => ({ data: {} }) });

	await assert.rejects(() => service.chat({}), (err) => {
		assert.equal(err.status, 400);
		assert.match(err.message, /prompt is required/);
		return true;
	});
});

test('AI_SERVER_BASE_URL과 AI_MODEL 환경변수를 사용한다', async () => {
	resetAiEnv();
	process.env.AI_SERVER_BASE_URL = 'http://192.168.0.50:11434';
	process.env.AI_MODEL = 'qwen2.5:1.5b';

	const service = createAiChatService({
		post: async (url, body) => {
			assert.equal(url, 'http://192.168.0.50:11434/api/generate');
			assert.equal(body.model, 'qwen2.5:1.5b');
			return { data: { response: '테스트 응답' } };
		},
	});

	const result = await service.chat({ prompt: '테스트' });
	assert.equal(result.response, '테스트 응답');
});
