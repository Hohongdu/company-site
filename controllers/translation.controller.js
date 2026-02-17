const papagoService = require('../services/papago.service');

function preview(text) {
	return String(text || '').replace(/\s+/g, ' ').slice(0, 80);
}

function detectProvider() {
	if (process.env.PAPAGO_CLIENT_ID && process.env.PAPAGO_CLIENT_SECRET) return 'ncp';
	if (process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET) return 'naver-openapi';
	return 'none';
}


function detectEnvState() {
	return {
		hasPapagoPair: Boolean(process.env.PAPAGO_CLIENT_ID && process.env.PAPAGO_CLIENT_SECRET),
		hasNaverPair: Boolean(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET),
	};
}

exports.status = async (req, res) => {
	const provider = detectProvider();
	const hasCredentials = provider !== 'none';
	const shouldProbe = String(req.query.probe || '0') === '1';

	if (!hasCredentials) {
		return res.status(200).json({
			ok: false,
			hasCredentials: false,
			provider,
			envState: detectEnvState(),
			providerNote: 'provider는 .env에 입력한 키 조합(PAPAGO_* 또는 NAVER_*)으로 자동 선택됩니다.',
			message: 'Papago 인증 정보가 없습니다. .env를 확인하세요.',
		});
	}

	if (!shouldProbe) {
		return res.json({
			ok: true,
			hasCredentials: true,
			provider,
			envState: detectEnvState(),
			providerNote: 'provider는 .env에 입력한 키 조합(PAPAGO_* 또는 NAVER_*)으로 자동 선택됩니다.',
			message: 'credential detected',
		});
	}

	try {
		await papagoService.translateText({ text: '테스트', source: 'ko', target: 'en' });
		return res.json({
			ok: true,
			hasCredentials: true,
			provider,
			envState: detectEnvState(),
			providerNote: 'provider는 .env에 입력한 키 조합(PAPAGO_* 또는 NAVER_*)으로 자동 선택됩니다.',
			message: 'live probe success',
		});
	} catch (err) {
		return res.status(err.status || err.response?.status || 500).json({
			ok: false,
			hasCredentials: true,
			provider,
			envState: detectEnvState(),
			providerNote: 'provider는 .env에 입력한 키 조합(PAPAGO_* 또는 NAVER_*)으로 자동 선택됩니다.',
			message: err.message || 'live probe failed',
			detail: err.response?.data || null,
		});
	}
};

exports.translate = async (req, res) => {
	const startedAt = Date.now();
	const requestId = req.headers['x-i18n-request-id'] || `srv-${startedAt}-${Math.random().toString(16).slice(2, 8)}`;
	const { text, source = 'auto', target } = req.body || {};

	console.info('[translate:req]', {
		requestId,
		target,
		source,
		len: typeof text === 'string' ? text.length : 0,
		preview: preview(text),
	});

	try {
		const result = await papagoService.translateText({ text, source, target });
		console.info('[translate:ok]', {
			requestId,
			target,
			sourceLang: result.sourceLang,
			durationMs: Date.now() - startedAt,
		});
		return res.json({ ok: true, requestId, ...result });
	} catch (err) {
		if (err.response?.data) {
			console.error('[translate:fail:papago]', {
				requestId,
				status: err.response.status,
				detail: err.response.data,
				hint: err.hint || null,
				diagnostics: err.diagnostics || null,
				durationMs: Date.now() - startedAt,
			});
			return res.status(err.response.status || 502).json({
				ok: false,
				requestId,
				message: err.message || 'Papago API 호출 중 오류가 발생했습니다.',
				hint: err.hint || null,
				diagnostics: err.diagnostics || null,
				detail: err.response.data,
			});
		}

		console.error('[translate:fail:internal]', {
			requestId,
			message: err.message,
			status: err.status,
			durationMs: Date.now() - startedAt,
		});
		return res.status(err.status || 500).json({
			ok: false,
			requestId,
			message: err.message || '번역 처리 중 오류가 발생했습니다.',
			hint: err.hint || null,
			diagnostics: err.diagnostics || null,
		});
	}
};
