const axios = require('axios');

const PAPAGO_ENDPOINT = 'https://naveropenapi.apigw.ntruss.com/nmt/v1/translation';

function getPapagoCredentials() {
	const clientId = process.env.PAPAGO_CLIENT_ID || process.env.NAVER_CLIENT_ID;
	const clientSecret = process.env.PAPAGO_CLIENT_SECRET || process.env.NAVER_CLIENT_SECRET;
	return { clientId, clientSecret };
}

function createPapagoService(httpClient = axios) {
	async function translateText({ text, source = 'auto', target }) {
		const { clientId, clientSecret } = getPapagoCredentials();

		if (!clientId || !clientSecret) {
			const err = new Error(
				'Papago API 인증 정보가 없습니다. .env에 PAPAGO_CLIENT_ID/PAPAGO_CLIENT_SECRET(또는 NAVER_CLIENT_ID/NAVER_CLIENT_SECRET)를 설정하세요.',
			);
			err.status = 500;
			throw err;
		}

		if (!text || typeof text !== 'string') {
			const err = new Error('번역할 text는 문자열로 입력해야 합니다.');
			err.status = 400;
			throw err;
		}

		if (!target || typeof target !== 'string') {
			const err = new Error('target 언어 코드를 입력해야 합니다.');
			err.status = 400;
			throw err;
		}

		const params = new URLSearchParams({
			source,
			target,
			text,
		});

		const response = await httpClient.post(PAPAGO_ENDPOINT, params.toString(), {
			headers: {
				'X-NCP-APIGW-API-KEY-ID': clientId,
				'X-NCP-APIGW-API-KEY': clientSecret,
				'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
			},
		});

		const translatedText = response?.data?.message?.result?.translatedText;
		if (!translatedText) {
			const err = new Error('Papago 응답 형식이 예상과 다릅니다.');
			err.status = 502;
			throw err;
		}

		return {
			translatedText,
			sourceLang: response.data.message.result.srcLangType,
			targetLang: response.data.message.result.tarLangType,
		};
	}

	return { translateText };
}

const papagoService = createPapagoService();

module.exports = {
	createPapagoService,
	translateText: papagoService.translateText,
};
