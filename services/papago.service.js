// services/papago.service.js
const axios = require('axios');

const NCP_ENDPOINT_PRIMARY = 'https://papago.apigw.ntruss.com/nmt/v1/translation';
const NCP_ENDPOINT_FALLBACK = 'https://naveropenapi.apigw.ntruss.com/nmt/v1/translation';
const DEFAULT_TIMEOUT_MS = 12_000;

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

	// 우선순위: PAPAGO_* (NCP) -> NAVER_* (구 OpenAPI)
	if (hasPapagoPair) {
		return {
			clientId: papagoId,
			clientSecret: papagoSecret,
			provider: 'ncp',
			hasPapagoPair,
			hasNaverPair,
		};
	}

	if (hasNaverPair) {
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

/**
 * provider별 요청 구성 생성
 */
function buildRequestConfig({ provider, clientId, clientSecret, source, target, text }) {
	if (!provider) {
		throw new Error('Papago credentials not found');
	}

	if (provider === 'ncp') {
		// NCP Papago Translation
		const params = new URLSearchParams();
		params.set('source', source);
		params.set('target', target);
		params.set('text', text);

		return {
			provider: 'ncp',
			endpoint: NCP_ENDPOINT_PRIMARY,
			headers: {
				// NCP 문서 기준 헤더
				'X-NCP-APIGW-API-KEY-ID': clientId,
				'X-NCP-APIGW-API-KEY': clientSecret,
				'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
			},
			data: params.toString(),
			timeout: DEFAULT_TIMEOUT_MS,
		};
	}

	if (provider === 'naver-openapi') {
		// (참고) 네이버 개발자센터 Open API - 보통 종료 상태라 실제로는 실패할 수 있음
		const params = new URLSearchParams();
		params.set('source', source);
		params.set('target', target);
		params.set('text', text);

		return {
			provider: 'naver-openapi',
			endpoint: NAVER_OPENAPI_ENDPOINT,
			headers: {
				'X-Naver-Client-Id': clientId,
				'X-Naver-Client-Secret': clientSecret,
				'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
			},
			data: params.toString(),
			timeout: DEFAULT_TIMEOUT_MS,
		};
	}

	throw new Error(`Unknown provider: ${provider}`);
}

/**
 * provider별 응답 파싱
 */
function parseTranslationResponse(provider, axiosResp) {
	const data = axiosResp?.data;

	if (provider === 'ncp') {
		// NCP Papago: { message: { result: { translatedText, ... } } }
		const translatedText = data?.message?.result?.translatedText;
		if (!translatedText) {
			throw new Error('NCP response parse failed');
		}
		return translatedText;
	}

	if (provider === 'naver-openapi') {
		// OpenAPI Papago: { message: { result: { translatedText } } } (형식 유사)
		const translatedText = data?.message?.result?.translatedText;
		if (!translatedText) {
			throw new Error('NAVER OpenAPI response parse failed');
		}
		return translatedText;
	}

	throw new Error(`Unknown provider: ${provider}`);
}

/**
 * 실제 번역 요청 1회 수행
 */
async function requestTranslationOnce(req) {
	const resp = await axios.post(req.endpoint, req.data, {
		headers: req.headers,
		timeout: req.timeout ?? DEFAULT_TIMEOUT_MS,
		// NCP 쪽이 HTTP/2 + gzip 등으로 내려올 수 있어서 기본 설정 그대로 둠
		validateStatus: (status) => status >= 200 && status < 300, // 2xx만 성공
	});

	return parseTranslationResponse(req.provider, resp);
}

/**
 * 번역 (primary + fallback)
 * - NCP면 endpoint primary 실패 시 fallback endpoint로 1회 재시도
 * - (옵션) naver-openapi는 대부분 종료라 cross-provider fallback은 기본 OFF.
 */
async function translateText({ text, source = 'ko', target = 'en' }) {
	if (!text || typeof text !== 'string') {
		throw new Error('text is required');
	}

	const creds = getPapagoCredentials();
	const { clientId, clientSecret, provider, hasPapagoPair, hasNaverPair } = creds;

	if (!provider || !clientId || !clientSecret) {
		return {
			ok: false,
			provider: provider ?? null,
			message: 'Papago credential is missing',
			translatedText: null,
			detail: null,
			envState: { hasPapagoPair, hasNaverPair },
		};
	}

	const primaryReq = buildRequestConfig({ provider, clientId, clientSecret, source, target, text });

	// 1) primary 시도
	try {
		const translatedText = await requestTranslationOnce(primaryReq);
		return {
			ok: true,
			provider: primaryReq.provider,
			message: 'success',
			translatedText,
			detail: null,
			envState: { hasPapagoPair, hasNaverPair },
		};
	} catch (err) {
		// 2) fallback 시도 (NCP면 endpoint만 바꿔서 한번 더)
		const primaryStatus = err?.response?.status ?? null;

		try {
			if (primaryReq.provider === 'ncp') {
				const fallbackReq = {
					...primaryReq,
					endpoint: NCP_ENDPOINT_FALLBACK,
					provider: 'ncp',
				};
				const translatedText = await requestTranslationOnce(fallbackReq);
				return {
					ok: true,
					provider: fallbackReq.provider,
					message: 'success (fallback endpoint)',
					translatedText,
					detail: { primaryStatus, usedFallback: true },
					envState: { hasPapagoPair, hasNaverPair },
				};
			}

			// naver-openapi는 서비스 종료 가능성이 커서 cross-provider fallback은 기본 비활성
			// 필요하면 여기서 NCP로 바꿔 재시도하는 로직을 추가해도 됨.
			throw err;
		} catch (err2) {
			const status2 = err2?.response?.status ?? primaryStatus;
			const providerLabel = primaryReq.provider;

			return {
				ok: false,
				provider: providerLabel,
				message:
					`Papago 인증/엔드포인트 실패(primary=${providerLabel}:${status2 ?? 'unknown'})` +
					`. App 등록 API 선택(Papago) 및 권한/활성화를 확인하세요.` +
					` PAPAGO_*는 X-NCP-APIGW-API-KEY-ID/KEY 쌍이어야 합니다.`,
				translatedText: null,
				detail: null, // 응답 바디/헤더를 여기서 노출하고 싶으면 확장 가능
				envState: { hasPapagoPair, hasNaverPair },
			};
		}
	}
}

/**
 * 상태 체크 (routes에서 /api/translate/status 구현할 때 사용)
 * - probe=true면 실제로 한번 번역 호출해서 살아있는지 확인 가능
 */
async function getStatus({ probe = false } = {}) {
	const creds = getPapagoCredentials();

	const res = {
		ok: true,
		hasCredentials: Boolean(creds.clientId && creds.clientSecret),
		provider: creds.provider,
		envState: {
			hasPapagoPair: creds.hasPapagoPair,
			hasNaverPair: creds.hasNaverPair,
		},
		providerNote: 'provider는 .env에 입력한 키 조합(PAPAGO_* 또는 NAVER_*)으로 자동 선택됩니다.',
		message: creds.clientId && creds.clientSecret ? 'credential detected' : 'credential missing',
	};

	if (!probe) return res;

	// probe 모드: 실제로 NCP 호출해보기
	try {
		const out = await translateText({ text: '테스트', source: 'ko', target: 'en' });
		if (!out.ok) {
			return {
				...res,
				ok: false,
				message: out.message,
				detail: out.detail ?? null,
			};
		}
		return {
			...res,
			ok: true,
			message: 'live probe success',
			detail: null,
		};
	} catch (e) {
		return {
			...res,
			ok: false,
			message: e?.message || 'probe failed',
			detail: null,
		};
	}
}

module.exports = {
	getPapagoCredentials,
	translateText,
	getStatus,
};
