const axios = require('axios');

const isEmailWebhookConfigured = () => Boolean(process.env.EMAIL_WEBHOOK_URL);

exports.sendInquiryReplyEmail = async ({ to, subject, html }) => {
	if (!isEmailWebhookConfigured()) {
		return { ok: false, status: 'SKIPPED', error: 'EMAIL_WEBHOOK_URL 설정이 없습니다.' };
	}

	try {
		await axios.post(
			process.env.EMAIL_WEBHOOK_URL,
			{
				to,
				subject,
				html,
				from: process.env.EMAIL_FROM || undefined,
			},
			{
				headers: process.env.EMAIL_WEBHOOK_TOKEN
					? { Authorization: `Bearer ${process.env.EMAIL_WEBHOOK_TOKEN}` }
					: undefined,
				timeout: 5000,
			},
		);
		return { ok: true, status: 'SENT', error: null };
	} catch (err) {
		return { ok: false, status: 'FAILED', error: String(err?.message || err) };
	}
};
