const aiService = require('../services/ai-chat.service');

exports.status = async (req, res) => {
	const data = await aiService.getStatus();
	return res.status(data.ok ? 200 : 503).json(data);
};

exports.chat = async (req, res) => {
	const { prompt, model } = req.body || {};
	try {
		const result = await aiService.chat({ prompt, model });
		return res.json({ ok: true, ...result });
	} catch (err) {
		return res.status(err.status || 500).json({
			ok: false,
			message: err.message || 'AI 처리 중 오류가 발생했습니다.',
			detail: err.response || null,
		});
	}
};
