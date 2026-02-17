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
	const naverId = cleanEnvValue(process.env.NAVER_CLIENT_ID);
	const naverSecret = cleanEnvValue(process.env.NAVER_CLIENT_SECRET);

	const hasPapagoPair = Boolean(papagoId && papagoSecret);
	const hasNaverPair = Boolean(naverId && naverSecret);

	if (papagoId && papagoSecret) {
		return {
			clientId: papagoId,
			clientSecret: papagoSecret,
			provider: 'ncp',
			hasPapagoPair,
			hasNaverPair,
		};
	}

	if (naverId && naverSecret) {
		return {
			clientId: naverId,
			clientSecret: naverSecret,
			provider: 'naver-openapi',
			hasPapagoPair,
			hasNaverPair,
		};
	}

	return {
		clientId: null,
		clientSecret: null,
		provider: null,
		hasPapagoPair,
		hasNaverPair,
	};
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

function buildFailureHint({ provider, status, detail }) {
	const errorCode = detail?.errorCode;
	if (provider === 'ncp' && (status === 401 || status === 403)) {
		return 'NCP Papago는 PAPAGO_CLIENT_ID=API Key ID, PAPAGO_CLIENT_SECRET=API Key 값이어야 합니다(Access Key/Secret Key 아님).';
	}
	if (provider === 'naver-openapi' && status === 404 && errorCode === '051') {
		return '네이버 개발자센터 앱에서 Papago 번역 API가 활성화되지 않았거나 앱 권한이 누락되었습니다.';
	}
	if (status === 404) {
		return '엔드포인트/상품 연결이 올바른지 확인하세요. 필요 시 PAPAGO_NCP_ENDPOINT 환경변수로 엔드포인트를 명시할 수 있습니다.';
	}
	return null;
}

function createPapagoService(httpClient = axios) {
	async function translateText({ text, source = 'auto', target }) {
		const { clientId, clientSecret, provider, hasPapagoPair, hasNaverPair } = getPapagoCredentials();

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
		const shouldRetryCrossProvider = hasPapagoPair && hasNaverPair;
		const fallbackProvider = primaryReq.provider === 'ncp' ? 'naver-openapi' : 'ncp';
		const fallbackReq = shouldRetryCrossProvider
			? buildRequestConfig({
					clientId: fallbackProvider === 'ncp' ? cleanEnvValue(process.env.PAPAGO_CLIENT_ID) : cleanEnvValue(process.env.NAVER_CLIENT_ID),
					clientSecret: fallbackProvider === 'ncp' ? cleanEnvValue(process.env.PAPAGO_CLIENT_SECRET) : cleanEnvValue(process.env.NAVER_CLIENT_SECRET),
					provider: fallbackProvider,
					params,
				})
			: null;

		try {
			return await requestTranslation(httpClient, primaryReq);
		} catch (err) {
			const status = err?.response?.status;
			const retryableStatus = new Set([401, 403, 404]);
			if (!retryableStatus.has(status)) {
				throw err;
			}

			if (!shouldRetryCrossProvider) {
				const authErr = new Error(
					`Papago 인증/엔드포인트 실패(primary=${primaryReq.provider}:${status}). 현재 .env는 단일 키 세트만 감지되어 cross-provider 재시도를 생략했습니다. App 등록 API 선택(Papago) 및 권한/활성화를 확인하세요. PAPAGO_*는 API Gateway Key ID/Key 쌍이어야 합니다.`,
				);
				authErr.status = 502;
				authErr.response = err.response;
				throw authErr;
			}

			try {
				return await requestTranslation(httpClient, fallbackReq);
			} catch (fallbackErr) {
				const fallbackStatus = fallbackErr?.response?.status;
				if (retryableStatus.has(fallbackStatus) || retryableStatus.has(status)) {
					const detail = fallbackErr.response?.data || err.response?.data || null;
					const hint = buildFailureHint({
						provider: primaryReq.provider,
						status: fallbackStatus || status,
						detail,
					});
					const authErr = new Error(
						`Papago 인증/엔드포인트 실패(primary=${primaryReq.provider}:${status}, fallback=${fallbackReq.provider}:${fallbackStatus || 'n/a'}). provider는 .env 키 조합으로 자동 선택됩니다(수동 설정값 아님). 키 타입/권한/서비스 활성화를 확인하세요.${hint ? ` 힌트: ${hint}` : ''}`,
					);
					authErr.status = 502;
					authErr.response = fallbackErr.response || err.response;
					authErr.hint = hint;
					authErr.diagnostics = {
						primaryProvider: primaryReq.provider,
						fallbackProvider: fallbackReq.provider,
						primaryEndpoint: primaryReq.endpoint,
						fallbackEndpoint: fallbackReq.endpoint,
					};
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
