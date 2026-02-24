const axios = require('axios');

const isEmailWebhookConfigured = () => Boolean(process.env.EMAIL_WEBHOOK_URL);

async function postEmailPayload(payload) {
	if (!isEmailWebhookConfigured()) {
		return { ok: false, status: 'SKIPPED', error: 'EMAIL_WEBHOOK_URL 설정이 없습니다.' };
	}

	try {
		await axios.post(process.env.EMAIL_WEBHOOK_URL, payload, {
			headers: process.env.EMAIL_WEBHOOK_TOKEN
				? { Authorization: `Bearer ${process.env.EMAIL_WEBHOOK_TOKEN}` }
				: undefined,
			timeout: 5000,
		});
		return { ok: true, status: 'SENT', error: null };
	} catch (err) {
		return { ok: false, status: 'FAILED', error: String(err?.message || err) };
	}
}

exports.sendInquiryReplyEmail = async ({ to, subject, html }) =>
	postEmailPayload({
		to,
		subject,
		html,
		from: process.env.EMAIL_FROM || undefined,
	});

exports.sendFileTransferEmail = async ({ to, senderName, senderEmail, message, filename, expiresAt, downloadUrl }) => {
	const subject = `[파일전송] ${senderName}님이 ${filename} 파일을 보냈습니다`;
	const html = `
    <h2>파일 전송 알림</h2>
    <p><strong>보낸 사람:</strong> ${senderName} (${senderEmail})</p>
    <p><strong>파일명:</strong> ${filename}</p>
    <p><strong>다운로드 만료:</strong> ${new Date(expiresAt).toLocaleString('ko-KR')}</p>
    <p><strong>메시지:</strong> ${message || '(메시지 없음)'}</p>
    <p><a href="${downloadUrl}">보안 링크로 파일 다운로드</a></p>
  `;

	return postEmailPayload({
		to,
		subject,
		html,
		from: process.env.EMAIL_FROM || undefined,
	});
};
