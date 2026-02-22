// services/papago.service.js
const axios = require('axios');

// 테스트/컨트롤러가 기대하는 엔드포인트 규약
// - PAPAGO_* (NCP) : apigw(ntruss) 엔드포인트 + X-NCP-* 헤더
// - NAVER_* (OpenAPI) : openapi.naver.com 엔드포인트 + X-Naver-* 헤더
const NCP_TRANSLATE_ENDPOINT = 'https://papago.apigw.ntruss.com/nmt/v1/translation';
const NAVER_OPENAPI_TRANSLATE_ENDPOINT = 'https://openapi.naver.com/v1/papago/n2mt';
const DEFAULT_TIMEOUT_MS = 12_000;

function cleanEnvValue(value) {
	if (typeof value !== 'string') return value;
	const trimmed = value.trim();
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

function hasPair(id, secret) {
	return Boolean(id && secret);
}

function getEnvState() {
	const papagoId = cleanEnvValue(process.env.PAPAGO_CLIENT_ID);
	const papagoSecret = cleanEnvValue(process.env.PAPAGO_CLIENT_SECRET);
	const naverId = cleanEnvValue(process.env.NAVER_CLIENT_ID);
	const naverSecret = cleanEnvValue(process.env.NAVER_CLIENT_SECRET);

	return {
		papagoId,
		papagoSecret,
		naverId,
		naverSecret,
		hasPapagoPair: hasPair(papagoId, papagoSecret),
		hasNaverPair: hasPair(naverId, naverSecret),
	};
}

function httpError(status, message, extra = {}) {
	const err = new Error(message);
	err.status = status;
	Object.assign(err, extra);
	return err;
}

function parseTranslatedText(data) {
	const translatedText = data?.message?.result?.translatedText;
	if (!translatedText) throw new Error('Papago response parse failed');
	return translatedText;
}

function createPapagoService(httpClient = axios) {
	if (!httpClient || typeof httpClient.post !== 'function') {
		throw new Error('httpClient with post(url, body, config) is required');
	}

	async function requestOnce({ provider, url, headers, source, target, text }) {
		const params = new URLSearchParams();
		params.set('source', source);
		params.set('target', target);
		params.set('text', text);

		const resp = await httpClient.post(url, params.toString(), {
			headers: {
				...headers,
				'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
			},
			timeout: DEFAULT_TIMEOUT_MS,
		});

		return {
			translatedText: parseTranslatedText(resp?.data),
			providerUsed: provider,
		};
	}

	async function translateText({ text, source = 'ko', target } = {}) {
		if (!target) throw httpError(400, 'target is required');
		if (!text || typeof text !== 'string') throw httpError(400, 'text is required');

		const env = getEnvState();
		if (!env.hasPapagoPair && !env.hasNaverPair) {
			throw httpError(500, 'Papago credentials not found');
		}

		// primary provider 선택 규칙: PAPAGO(NCP) 우선
		const primary = env.hasPapagoPair
			? {
				provider: 'ncp',
				url: NCP_TRANSLATE_ENDPOINT,
				headers: {
					'X-NCP-APIGW-API-KEY-ID': env.papagoId,
					'X-NCP-APIGW-API-KEY': env.papagoSecret,
				},
			}
			: {
				provider: 'naver-openapi',
				url: NAVER_OPENAPI_TRANSLATE_ENDPOINT,
				headers: {
					'X-Naver-Client-Id': env.naverId,
					'X-Naver-Client-Secret': env.naverSecret,
				},
			};

		const fallback = env.hasPapagoPair && env.hasNaverPair
			? {
				provider: primary.provider === 'ncp' ? 'naver-openapi' : 'ncp',
				url: primary.provider === 'ncp' ? NAVER_OPENAPI_TRANSLATE_ENDPOINT : NCP_TRANSLATE_ENDPOINT,
				headers:
					primary.provider === 'ncp'
						? {
							'X-Naver-Client-Id': env.naverId,
							'X-Naver-Client-Secret': env.naverSecret,
						}
						: {
							'X-NCP-APIGW-API-KEY-ID': env.papagoId,
							'X-NCP-APIGW-API-KEY': env.papagoSecret,
						},
			}
			: null;

		try {
			return await requestOnce({ ...primary, source, target, text });
		} catch (err) {
			const status = err?.response?.status;

			// fallback 조건: 양쪽 키세트가 있고, primary가 403/404면 cross-provider로 1회 재시도
			if (fallback && (status === 403 || status === 404)) {
				try {
					return await requestOnce({ ...fallback, source, target, text });
				} catch (err2) {
					const status2 = err2?.response?.status ?? status;
					throw httpError(
						502,
						`Papago 인증/엔드포인트 실패(primary=${primary.provider}:${status ?? 'unknown'}, fallback=${fallback.provider}:${status2 ?? 'unknown'})`,
						{ response: err2?.response || err?.response }
					);
				}
			}

			// 단일 키세트면 cross-provider fallback 자체가 없음
			if (!fallback && status === 403) {
				throw httpError(502, 'Papago 인증/엔드포인트 실패: cross-provider 재시도를 생략합니다.', {
					response: err?.response,
				});
			}

			// 그 외는 502로 변환
			throw httpError(502, 'Papago 인증/엔드포인트 실패', { response: err?.response });
		}
	}

	async function getStatus({ probe = false } = {}) {
		const env = getEnvState();
		const provider = env.hasPapagoPair ? 'ncp' : env.hasNaverPair ? 'naver-openapi' : 'none';
		const hasCredentials = provider !== 'none';

		const base = {
			ok: hasCredentials,
			hasCredentials,
			provider,
			envState: { hasPapagoPair: env.hasPapagoPair, hasNaverPair: env.hasNaverPair },
			providerNote: 'provider는 .env에 입력한 키 조합(PAPAGO_* 또는 NAVER_*)으로 자동 선택됩니다.',
			message: hasCredentials ? 'credential detected' : 'credential missing',
		};

		if (!probe || !hasCredentials) return base;

		try {
			await translateText({ text: '테스트', source: 'ko', target: 'en' });
			return { ...base, ok: true, message: 'live probe success' };
		} catch (e) {
			return { ...base, ok: false, message: e?.message || 'probe failed' };
		}
	}

	return { translateText, getStatus };
}

// 기본 인스턴스(컨트롤러가 바로 require해서 사용)
const defaultService = createPapagoService(axios);

module.exports = {
	createPapagoService,
	translateText: defaultService.translateText,
	getStatus: defaultService.getStatus,
};
