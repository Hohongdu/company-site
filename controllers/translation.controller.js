const papagoService = require('../services/papago.service');

exports.translate = async (req, res) => {
	try {
		const { text, source = 'auto', target } = req.body || {};
		const result = await papagoService.translateText({ text, source, target });
		return res.json({ ok: true, ...result });
	} catch (err) {
		if (err.response?.data) {
			return res.status(err.response.status || 502).json({
				ok: false,
				message: 'Papago API 호출 중 오류가 발생했습니다.',
				detail: err.response.data,
			});
		}

		return res.status(err.status || 500).json({
			ok: false,
			message: err.message || '번역 처리 중 오류가 발생했습니다.',
		});
	}
};
