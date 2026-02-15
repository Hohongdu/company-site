const axios = require('axios');

const NCP_ENDPOINT = 'https://naveropenapi.apigw.ntruss.com/nmt/v1/translation';
const NAVER_OPENAPI_ENDPOINT = 'https://openapi.naver.com/v1/papago/n2mt';

function getPapagoCredentials() {
	if (process.env.PAPAGO_CLIENT_ID && process.env.PAPAGO_CLIENT_SECRET) {
		return {
			clientId: process.env.PAPAGO_CLIENT_ID,
			clientSecret: process.env.PAPAGO_CLIENT_SECRET,
			provider: 'ncp',
		};
	}

	if (process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET) {
		return {
			clientId: process.env.NAVER_CLIENT_ID,
			clientSecret: process.env.NAVER_CLIENT_SECRET,
			provider: 'naver-openapi',
		};
	}

	return { clientId: null, clientSecret: null, provider: null };
}

function buildRequestConfig({ clientId, clientSecret, provider, params }) {
	if (provider === 'naver-openapi') {
		return {
			endpoint: NAVER_OPENAPI_ENDPOINT,
			headers: {
				'X-Naver-Client-Id': clientId,
				'X-Naver-Client-Secret': clientSecret,
				'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
			},
			body: params.toString(),
		};
	}

	return {
		endpoint: NCP_ENDPOINT,
		headers: {
			'X-NCP-APIGW-API-KEY-ID': clientId,
			'X-NCP-APIGW-API-KEY': clientSecret,
			'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
		},
		body: params.toString(),
	};
}

function createPapagoService(httpClient = axios) {
	async function translateText({ text, source = 'auto', target }) {
		const { clientId, clientSecret, provider } = getPapagoCredentials();

		if (!clientId || !clientSecret) {
			const err = new Error(
				'Papago API 인증 정보가 없습니다. .env에 PAPAGO_CLIENT_ID/PAPAGO_CLIENT_SECRET 또는 NAVER_CLIENT_ID/NAVER_CLIENT_SECRET를 설정하세요.',
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

		const params = new URLSearchParams({ source, target, text });
		const req = buildRequestConfig({ clientId, clientSecret, provider, params });

		try {
			const response = await httpClient.post(req.endpoint, req.body, { headers: req.headers });

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
		} catch (err) {
			const status = err?.response?.status;
			if (status === 401 || status === 403) {
				const authErr = new Error(
					`Papago 인증 실패(${status}). 현재 provider=${provider}. 키 타입과 엔드포인트가 일치하는지 확인하세요.`,
				);
				authErr.status = 502;
				authErr.response = err.response;
				throw authErr;
			}
			throw err;
		}
	}

	return { translateText };
}

const papagoService = createPapagoService();

module.exports = {
	createPapagoService,
	translateText: papagoService.translateText,
};
