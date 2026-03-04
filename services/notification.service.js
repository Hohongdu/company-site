const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const isEmailWebhookConfigured = () => Boolean(process.env.EMAIL_WEBHOOK_URL);
const isSendmailConfigured = () => Boolean(process.env.EMAIL_SENDMAIL_BIN);

function escapeHeader(value) {
	return String(value || '')
		.replace(/\r/g, ' ')
		.replace(/\n/g, ' ')
		.trim();
}

function stripHtml(html) {
	return String(html || '')
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

async function writeMailToLocalOutbox(payload) {
	const outboxDir = process.env.EMAIL_OUTBOX_DIR || path.join(__dirname, '..', 'uploads', 'mail-outbox');
	await fs.mkdir(outboxDir, { recursive: true });
	const now = new Date();
	const filePath = path.join(outboxDir, `${now.toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2)}.json`);
	await fs.writeFile(filePath, JSON.stringify({ createdAt: now.toISOString(), ...payload }, null, 2), 'utf8');
	return filePath;
}

function sendBySendmail({ to, subject, html, from }) {
	return new Promise((resolve) => {
		const sendmailPath = process.env.EMAIL_SENDMAIL_BIN;
		const sender = escapeHeader(from || process.env.EMAIL_FROM || 'no-reply@localhost');
		const recipient = escapeHeader(to);
		const safeSubject = escapeHeader(subject);
		const bodyText = stripHtml(html);
		const rawMail = [
			`From: ${sender}`,
			`To: ${recipient}`,
			`Subject: ${safeSubject}`,
			'MIME-Version: 1.0',
			'Content-Type: text/plain; charset=UTF-8',
			'',
			bodyText,
		].join('\n');

		const proc = spawn(sendmailPath, ['-t', '-i']);
		let stderr = '';

		proc.stderr.on('data', (chunk) => {
			stderr += chunk.toString();
		});

		proc.on('error', (err) => {
			resolve({ ok: false, status: 'FAILED', error: String(err?.message || err), provider: 'SENDMAIL' });
		});

		proc.on('close', (code) => {
			if (code === 0) return resolve({ ok: true, status: 'SENT', error: null, provider: 'SENDMAIL' });
			return resolve({ ok: false, status: 'FAILED', error: stderr.trim() || `sendmail exited with ${code}`, provider: 'SENDMAIL' });
		});

		proc.stdin.end(rawMail);
	});
}

async function postEmailPayload(payload) {
	if (isSendmailConfigured()) {
		return sendBySendmail(payload);
	}

	if (isEmailWebhookConfigured()) {
		try {
			await axios.post(process.env.EMAIL_WEBHOOK_URL, payload, {
				headers: process.env.EMAIL_WEBHOOK_TOKEN
					? { Authorization: `Bearer ${process.env.EMAIL_WEBHOOK_TOKEN}` }
					: undefined,
				timeout: 5000,
			});
			return { ok: true, status: 'SENT', error: null, provider: 'WEBHOOK' };
		} catch (err) {
			return { ok: false, status: 'FAILED', error: String(err?.message || err), provider: 'WEBHOOK' };
		}
	}

	const outboxPath = await writeMailToLocalOutbox(payload);
	return {
		ok: false,
		status: 'SKIPPED',
		error: null,
		provider: 'LOCAL_OUTBOX',
		message: `이메일 설정이 없어 실제 전송 대신 로컬 아웃박스에 저장했습니다. (${outboxPath})`,
	};
}

exports.sendInquiryReplyEmail = async ({ to, subject, html, downloadUrl, fileName, expiresAt }) => {
	const attachmentHtml = downloadUrl
		? `
    <div style="margin-top:12px; padding:12px; border:1px solid #e5e7eb; border-radius:8px;">
      <div><strong>첨부 파일:</strong> ${fileName || '파일 링크'}</div>
      <div><strong>다운로드 만료:</strong> ${expiresAt ? new Date(expiresAt).toLocaleString('ko-KR') : '-'}</div>
      <div style="margin-top:8px;"><a href="${downloadUrl}">보안 링크로 파일 다운로드</a></div>
    </div>
  `
		: '';

	return postEmailPayload({
		to,
		subject,
		html: `${html}${attachmentHtml}`,
		from: process.env.EMAIL_FROM || undefined,
	});
};

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

exports.sendTemporaryPasswordEmail = async ({ to, userName, temporaryPassword }) => {
	const subject = '[비밀번호 재설정] 임시 비밀번호 안내';
	const html = `
    <div style="font-family:Arial,sans-serif; line-height:1.6;">
      <h2 style="margin-bottom:8px;">임시 비밀번호가 발급되었습니다</h2>
      <p>안녕하세요 ${userName || '고객'}님, 요청하신 임시 비밀번호를 안내드립니다.</p>
      <div style="padding:12px; background:#f7f7f7; border-radius:8px; margin:12px 0;">
        <strong>임시 비밀번호:</strong> ${temporaryPassword}
      </div>
      <p>로그인 후 <strong>반드시 비밀번호를 변경</strong>해 주세요.</p>
    </div>
  `;

	return postEmailPayload({
		to,
		subject,
		html,
		from: process.env.EMAIL_FROM || undefined,
	});
};
