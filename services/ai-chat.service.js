const axios = require('axios');

const DEFAULT_TIMEOUT_MS = 15000;

function httpError(status, message, extra = {}) {
	const err = new Error(message);
	err.status = status;
	Object.assign(err, extra);
	return err;
}

function cleanEnvValue(value, fallback = '') {
	if (typeof value !== 'string') return fallback;
	const trimmed = value.trim();
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

function createAiChatService(httpClient = axios) {
	if (!httpClient || typeof httpClient.post !== 'function') {
		throw new Error('httpClient with post(url, body, config) is required');
	}

	function getConfig() {
		const baseUrl = cleanEnvValue(process.env.AI_SERVER_BASE_URL, 'http://127.0.0.1:11434');
		const model = cleanEnvValue(process.env.AI_MODEL, 'llama3.2:1b');
		const route = cleanEnvValue(process.env.AI_GENERATE_PATH, '/api/generate');
		return { baseUrl, model, route };
	}

	async function chat({ prompt, model } = {}) {
		if (!prompt || typeof prompt !== 'string') {
			throw httpError(400, 'prompt is required');
		}

		const cfg = getConfig();
		const targetModel = model || cfg.model;
		const endpoint = `${cfg.baseUrl}${cfg.route}`;

		try {
			const response = await httpClient.post(
				endpoint,
				{
					model: targetModel,
					prompt,
					stream: false,
				},
				{ timeout: DEFAULT_TIMEOUT_MS }
			);

			const text = response?.data?.response;
			if (!text || typeof text !== 'string') {
				throw httpError(502, 'AI response parse failed', { response: response?.data || null });
			}

			return {
				model: response?.data?.model || targetModel,
				response: text,
				totalDuration: response?.data?.total_duration || null,
			};
		} catch (err) {
			if (err.status) throw err;
			throw httpError(err?.response?.status || 502, 'AI 서버 호출에 실패했습니다.', {
				response: err?.response?.data || null,
			});
		}
	}

	async function getStatus() {
		const cfg = getConfig();
		try {
			await chat({ prompt: 'ping' });
			return {
				ok: true,
				baseUrl: cfg.baseUrl,
				model: cfg.model,
				message: 'AI server reachable',
			};
		} catch (err) {
			return {
				ok: false,
				baseUrl: cfg.baseUrl,
				model: cfg.model,
				message: err.message,
			};
		}
	}

	return { chat, getStatus, getConfig };
}

const defaultService = createAiChatService(axios);

module.exports = {
	createAiChatService,
	chat: defaultService.chat,
	getStatus: defaultService.getStatus,
	getConfig: defaultService.getConfig,
};
