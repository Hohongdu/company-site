// services/notification.service.js
// 이메일 알림 서비스: email.service.js를 통해 Gmail SMTP 발송

'use strict';

const { sendMail, isConfigured } = require('./email.service');

// ── 공통 HTML 래퍼 ─────────────────────────────────────
function wrapHtml(title, bodyHtml) {
	return `
<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin:0; padding:0; background:#f4f4f4; }
  .wrap { max-width:560px; margin:32px auto; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,.08); }
  .header { background:#111; padding:24px 32px; }
  .header h1 { color:#fff; margin:0; font-size:18px; font-weight:600; letter-spacing:.5px; }
  .body { padding:32px; color:#222; line-height:1.7; font-size:15px; }
  .body h2 { font-size:16px; margin:0 0 16px; }
  .highlight { background:#f0f4ff; border-left:4px solid #3b5bdb; padding:12px 16px; border-radius:4px; margin:16px 0; font-weight:600; font-size:16px; letter-spacing:.5px; }
  .footer { background:#f9f9f9; padding:16px 32px; font-size:12px; color:#888; border-top:1px solid #eee; }
</style></head>
<body>
<div class="wrap">
  <div class="header"><h1>ENERMADE</h1></div>
  <div class="body">
    <h2>${title}</h2>
    ${bodyHtml}
  </div>
  <div class="footer">본 메일은 발신 전용입니다. 문의는 홈페이지 문의 페이지를 이용해주세요.</div>
</div>
</body></html>`;
}

// ── 1. 문의 답변 알림 ──────────────────────────────────
/**
 * @param {{ to: string, name?: string, inquiryTitle: string, replyContent: string }} payload
 */
exports.sendInquiryReplyEmail = async (payload) => {
	const { to, name, inquiryTitle, replyContent } = payload;

	if (!to) return { ok: false, status: 'SKIPPED', error: '수신 이메일 없음' };
	if (!isConfigured()) return { ok: false, status: 'DISABLED', error: 'SMTP 미설정' };

	const greeting = name ? `${name}님,` : '안녕하세요,';
	const html = wrapHtml(
		'문의 답변 도착',
		`<p>${greeting} 문의하신 내용에 대한 답변이 등록되었습니다.</p>
		<p><strong>문의 제목:</strong> ${inquiryTitle}</p>
		<p><strong>답변 내용:</strong></p>
		<div style="background:#fafafa;border:1px solid #eee;border-radius:4px;padding:12px 16px;margin:8px 0;">${replyContent.replace(/\n/g, '<br>')}</div>
		<p style="margin-top:24px;">추가 문의사항이 있으시면 홈페이지 문의 페이지를 이용해주세요.</p>`,
	);

	return sendMail({ to, subject: `[ENERMADE] 문의 답변: ${inquiryTitle}`, html });
};

// ── 2. 임시 비밀번호 발송 ──────────────────────────────
/**
 * @param {{ to: string, name?: string, tempPassword: string }} payload
 */
exports.sendTemporaryPasswordEmail = async (payload) => {
	const { to, name, tempPassword } = payload;

	if (!to) return { ok: false, status: 'SKIPPED', error: '수신 이메일 없음' };
	if (!isConfigured()) return { ok: false, status: 'DISABLED', error: 'SMTP 미설정' };

	const greeting = name ? `${name}님,` : '안녕하세요,';
	const html = wrapHtml(
		'임시 비밀번호 발급',
		`<p>${greeting} 요청하신 임시 비밀번호가 발급되었습니다.</p>
		<div class="highlight">${tempPassword}</div>
		<p>로그인 후 <strong>반드시 비밀번호를 변경</strong>해주세요.</p>
		<p style="color:#e74c3c;font-size:13px;">본인이 요청하지 않은 경우 이 메일을 무시하시고, 계정 보안을 확인해주세요.</p>`,
	);

	return sendMail({ to, subject: '[ENERMADE] 임시 비밀번호 발급 안내', html });
};

// ── 3. 파일 전송 알림 (기존 stub 유지) ────────────────
exports.sendFileTransferEmail = async (payload) => {
	if (!isConfigured()) return { ok: false, status: 'DISABLED', error: 'SMTP 미설정' };
	return sendMail({
		to: payload.to,
		subject: '[ENERMADE] 파일 전송 알림',
		html: wrapHtml('파일 전송 완료', `<p>파일이 전송되었습니다.</p>`),
	});
};
