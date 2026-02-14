const papagoService = require('../services/papago.service');

function preview(text) {
	return String(text || '').replace(/\s+/g, ' ').slice(0, 80);
}

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
				durationMs: Date.now() - startedAt,
			});
			return res.status(err.response.status || 502).json({
				ok: false,
				requestId,
				message: 'Papago API 호출 중 오류가 발생했습니다.',
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
		});
	}
};
