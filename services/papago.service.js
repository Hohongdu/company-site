const axios = require('axios');

const NCP_ENDPOINT_PRIMARY = 'https://papago.apigw.ntruss.com/nmt/v1/translation';
const NCP_ENDPOINT_FALLBACK = 'https://naveropenapi.apigw.ntruss.com/nmt/v1/translation';

function cleanEnvValue(value) {
	if (typeof value !== 'string') return value;
	const trimmed = value.trim();
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

function getPapagoCredentials() {
	const papagoId = cleanEnvValue(process.env.PAPAGO_CLIENT_ID);
	const papagoSecret = cleanEnvValue(process.env.PAPAGO_CLIENT_SECRET);
	if (papagoId && papagoSecret) {
		return {
			clientId: papagoId,
			clientSecret: papagoSecret,
			provider: 'ncp',
		};
	}

	const naverId = cleanEnvValue(process.env.NAVER_CLIENT_ID);
	const naverSecret = cleanEnvValue(process.env.NAVER_CLIENT_SECRET);
	if (naverId && naverSecret) {
		return {
			clientId: naverId,
			clientSecret: naverSecret,
			provider: 'naver-openapi',
		};
	}

	return { clientId: null, clientSecret: null, provider: null };
}

function buildRequestConfig({ clientId, clientSecret, provider, params }) {
	if (provider === 'naver-openapi') {
		return {
			provider: 'ncp',
			endpoint: NCP_ENDPOINT_PRIMARY,
			fallbackEndpoint: NCP_ENDPOINT_FALLBACK,
			headers: {
				'X-NCP-APIGW-API-KEY-ID': clientId,
				'X-NCP-APIGW-API-KEY': clientSecret,
				'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
			},
			body: params.toString(),
		};
	}

	return {
		provider: 'ncp',
		endpoint: NCP_ENDPOINT,
		headers: {
			'X-NCP-APIGW-API-KEY-ID': clientId,
			'X-NCP-APIGW-API-KEY': clientSecret,
			'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
		},
		body: params.toString(),
	};
}

async function requestTranslation(httpClient, requestConfig) {
	const response = await httpClient.post(requestConfig.endpoint, requestConfig.body, {
		headers: requestConfig.headers,
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
		providerUsed: requestConfig.provider,
	};
}

function createPapagoService(httpClient = axios) {
	async function translateText({ text, source = 'auto', target }) {
		const { clientId, clientSecret, provider } = getPapagoCredentials();

		if (!clientId || !clientSecret) {
			const err = new Error('Papago API 인증 정보가 없습니다. .env에 PAPAGO_CLIENT_ID/PAPAGO_CLIENT_SECRET 또는 NAVER_CLIENT_ID/NAVER_CLIENT_SECRET를 설정하세요.');
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
		const primaryReq = buildRequestConfig({ clientId, clientSecret, provider, params });
		const fallbackProvider = primaryReq.provider === 'ncp' ? 'naver-openapi' : 'ncp';
		const fallbackReq = buildRequestConfig({ clientId, clientSecret, provider: fallbackProvider, params });

		try {
			return await requestTranslation(httpClient, primaryReq);
		} catch (err) {
			const status = err?.response?.status;
			const retryableStatus = new Set([401, 403, 404]);
			if (!retryableStatus.has(status)) {
				throw err;
			}

			try {
				return await requestTranslation(httpClient, fallbackReq);
			} catch (fallbackErr) {
				const fallbackStatus = fallbackErr?.response?.status;
				if (retryableStatus.has(fallbackStatus) || retryableStatus.has(status)) {
					const authErr = new Error(
						`Papago 인증/엔드포인트 실패(primary=${primaryReq.provider}:${status}, fallback=${fallbackReq.provider}:${fallbackStatus || 'n/a'}). provider는 .env 키 조합으로 자동 선택됩니다(수동 설정값 아님). 키 타입/권한/서비스 활성화를 확인하세요.`,
					);
					authErr.status = 502;
					authErr.response = fallbackErr.response || err.response;
					throw authErr;
				}
				throw fallbackErr;
			}
		}
	}

	return { translateText };
}

const papagoService = createPapagoService();

module.exports = {
	createPapagoService,
	translateText: papagoService.translateText,
};
