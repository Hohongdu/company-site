// services/notification.service.js
// 이메일 알림 서비스: email.service.js를 통해 Gmail SMTP 발송

'use strict';

const { sendMail, isConfigured } = require('./email.service');

// 이메일 HTML에 삽입되는 모든 사용자 입력값을 escape
// 줄바꿈 보존이 필요한 경우 escLines() 사용
function esc(str) {
	return String(str ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function escLines(str) {
	return esc(str).replace(/\n/g, '<br>');
}

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

	if (!to) return { ok: false, status: 'SKIPPED', provider: 'NONE', error: '수신 이메일 없음' };
	if (!isConfigured()) return { ok: false, status: 'DISABLED', provider: 'NONE', error: 'SMTP 비활성화 — 이메일 발송이 비활성화 상태입니다' };

	const greeting = name ? `${esc(name)}님,` : '안녕하세요,';
	const html = wrapHtml(
		'문의 답변 도착',
		`<p>${greeting} 문의하신 내용에 대한 답변이 등록되었습니다.</p>
		<p><strong>문의 제목:</strong> ${esc(inquiryTitle)}</p>
		<p><strong>답변 내용:</strong></p>
		<div style="background:#fafafa;border:1px solid #eee;border-radius:4px;padding:12px 16px;margin:8px 0;">${escLines(replyContent)}</div>
		<p style="margin-top:24px;">추가 문의사항이 있으시면 홈페이지 문의 페이지를 이용해주세요.</p>`,
	);

	return sendMail({ to, subject: `[ENERMADE] 문의 답변: ${esc(inquiryTitle)}`, html });
};

// ── 2. 임시 비밀번호 발송 ──────────────────────────────
/**
 * @param {{ to: string, name?: string, tempPassword: string }} payload
 */
exports.sendTemporaryPasswordEmail = async (payload) => {
	const { to, name, tempPassword, temporaryPassword } = payload;
	const password = tempPassword || temporaryPassword;

	if (!to) return { ok: false, status: 'SKIPPED', provider: 'NONE', error: '수신 이메일 없음' };
	if (!isConfigured()) return { ok: false, status: 'DISABLED', provider: 'NONE', error: 'SMTP 비활성화 — 이메일 발송이 비활성화 상태입니다' };

	const greeting = name ? `${esc(name)}님,` : '안녕하세요,';
	const html = wrapHtml(
		'임시 비밀번호 발급',
		`<p>${greeting} 요청하신 임시 비밀번호가 발급되었습니다.</p>
		<div class="highlight">${esc(password)}</div>
		<p>로그인 후 <strong>반드시 비밀번호를 변경</strong>해주세요.</p>
		<p style="color:#e74c3c;font-size:13px;">본인이 요청하지 않은 경우 이 메일을 무시하시고, 계정 보안을 확인해주세요.</p>`,
	);

	return sendMail({ to, subject: '[ENERMADE] 임시 비밀번호 발급 안내', html });
};

// ── 3. 새 문의 → 관리자 알림 ──────────────────────────
/**
 * @param {{ name: string, email: string, message: string, id?: number }} payload
 */
exports.sendNewInquiryToAdmin = async (payload) => {
	const { name, email, message, id } = payload;
	const adminEmail =
		process.env.ADMIN_EMAIL ||
		process.env.EMAIL_FROM ||
		process.env.SMTP_USER;

	if (!adminEmail) return { ok: false, status: 'SKIPPED', error: '관리자 이메일 미설정' };
	if (!isConfigured()) return { ok: false, status: 'DISABLED', error: 'SMTP 미설정' };

	const html = wrapHtml(
		'새 문의가 접수되었습니다',
		`<p>새로운 문의가 웹사이트를 통해 접수되었습니다.</p>
		<table style="width:100%;border-collapse:collapse;font-size:14px;">
			<tr><td style="padding:8px 0;color:#666;width:90px;">문의자</td><td style="padding:8px 0;font-weight:600;">${esc(name)}</td></tr>
			<tr><td style="padding:8px 0;color:#666;">이메일</td><td style="padding:8px 0;">${esc(email)}</td></tr>
			${id ? `<tr><td style="padding:8px 0;color:#666;">문의 ID</td><td style="padding:8px 0;">#${Number(id)}</td></tr>` : ''}
		</table>
		<div class="highlight" style="background:#fff7ed;border-left:4px solid #ea580c;padding:12px 16px;border-radius:4px;margin:16px 0;font-size:14px;line-height:1.7;">${escLines(message)}</div>
		<p style="margin-top:20px;">
			<a href="${process.env.BASE_URL || 'http://localhost:3000'}/admin/inquiries"
			   style="background:#ea580c;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">
				관리자 대시보드에서 확인하기
			</a>
		</p>`,
	);

	return sendMail({ to: adminEmail, subject: `[ENERMADE] 새 문의: ${esc(name)}님`, html });
};

// ── 4. 주문 완료 확인 이메일 ────────────────────────────
/**
 * @param {{
 *   to: string,
 *   name?: string,
 *   orderId: number|string,
 *   orderItems: Array<{ name: string, quantity: number, price: number }>,
 *   totalAmount: number,
 *   paymentMethod?: string
 * }} payload
 */
exports.sendOrderConfirmEmail = async (payload) => {
	const { to, name, orderId, orderItems = [], totalAmount, paymentMethod } = payload;

	if (!to) return { ok: false, status: 'SKIPPED', error: '수신 이메일 없음' };
	if (!isConfigured()) return { ok: false, status: 'DISABLED', error: '메일 드라이버 미설정' };

	const greeting = name ? `${esc(name)}님,` : '안녕하세요,';
	const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
	const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');

	const itemRows = orderItems
		.map(
			(item) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;">${esc(item.name)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:center;">${Number(item.quantity)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right;">₩${fmt(item.price * item.quantity)}</td>
      </tr>`,
		)
		.join('');

	const html = wrapHtml(
		'주문이 완료되었습니다',
		`<p>${greeting} 주문이 정상적으로 접수되었습니다.</p>
		<table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;">
			<thead>
				<tr style="border-bottom:2px solid #eee;">
					<th style="padding:8px 0;text-align:left;color:#666;">상품명</th>
					<th style="padding:8px 0;text-align:center;color:#666;">수량</th>
					<th style="padding:8px 0;text-align:right;color:#666;">금액</th>
				</tr>
			</thead>
			<tbody>${itemRows}</tbody>
		</table>
		<div class="highlight" style="text-align:right;">결제 금액: ₩${fmt(totalAmount)}</div>
		${paymentMethod ? `<p style="color:#666;font-size:13px;">결제 수단: ${esc(paymentMethod)}</p>` : ''}
		<p style="margin-top:24px;">
			<a href="${baseUrl}/shop/orders/${orderId}"
			   style="background:#111;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">
				주문 상세 확인하기
			</a>
		</p>`,
	);

	return sendMail({
		to,
		subject: `[ENERMADE] 주문 완료 (#${orderId})`,
		html,
	});
};

// ── 5. 파일 전송 알림 (기존 stub 유지) ────────────────
exports.sendFileTransferEmail = async (payload) => {
	if (!isConfigured()) return { ok: false, status: 'DISABLED', error: '메일 드라이버 미설정' };
	return sendMail({
		to: payload.to,
		subject: '[ENERMADE] 파일 전송 알림',
		html: wrapHtml('파일 전송 완료', `<p>파일이 전송되었습니다.</p>`),
	});
};

// ── 6. RFQ 견적 요청 → 관리자 알림 ───────────────────
/**
 * @param {{ contactName: string, contactEmail: string, companyName: string, productName: string, quantity: number, targetPrice: string, deliveryDate: string, message: string, id?: number }} payload
 */
exports.sendRfqToAdmin = async (payload) => {
	const { contactName, contactEmail, companyName, productName, quantity, targetPrice, deliveryDate, message, id } = payload;
	const adminEmail =
		process.env.ADMIN_EMAIL ||
		process.env.EMAIL_FROM ||
		process.env.SMTP_USER;

	if (!adminEmail) return { ok: false, status: 'SKIPPED', error: '관리자 이메일 미설정' };
	if (!isConfigured()) return { ok: false, status: 'DISABLED', error: 'SMTP 미설정' };

	const html = wrapHtml(
		'새 견적 요청이 접수되었습니다',
		`<p>새로운 견적 요청이 웹사이트를 통해 접수되었습니다.</p>
		<table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;">
			<tr><td style="padding:8px 0;color:#666;width:100px;border-bottom:1px solid #f0f0f0;">담당자</td><td style="padding:8px 0;font-weight:600;border-bottom:1px solid #f0f0f0;">${esc(contactName)}</td></tr>
			<tr><td style="padding:8px 0;color:#666;border-bottom:1px solid #f0f0f0;">이메일</td><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;">${esc(contactEmail)}</td></tr>
			<tr><td style="padding:8px 0;color:#666;border-bottom:1px solid #f0f0f0;">회사명</td><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;">${esc(companyName || '(미입력)')}</td></tr>
			<tr><td style="padding:8px 0;color:#666;border-bottom:1px solid #f0f0f0;">상품명</td><td style="padding:8px 0;font-weight:600;border-bottom:1px solid #f0f0f0;">${esc(productName || '(미입력)')}</td></tr>
			<tr><td style="padding:8px 0;color:#666;border-bottom:1px solid #f0f0f0;">수량</td><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;">${Number(quantity)}개</td></tr>
			<tr><td style="padding:8px 0;color:#666;border-bottom:1px solid #f0f0f0;">목표 단가</td><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;">${esc(targetPrice || '협의')}</td></tr>
			<tr><td style="padding:8px 0;color:#666;border-bottom:1px solid #f0f0f0;">희망 납기</td><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;">${esc(deliveryDate || '협의')}</td></tr>
			${id ? `<tr><td style="padding:8px 0;color:#666;">문의 ID</td><td style="padding:8px 0;">#${Number(id)}</td></tr>` : ''}
		</table>
		${message ? `<p style="color:#444;font-size:14px;margin-top:8px;font-weight:600;">요청사항:</p><div style="background:#fafafa;border:1px solid #eee;border-radius:4px;padding:12px 16px;margin:8px 0;font-size:14px;">${escLines(message)}</div>` : ''}
		<p style="margin-top:20px;">
			<a href="${process.env.BASE_URL || 'http://localhost:3000'}/admin/inquiries"
			   style="background:#3b5bdb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">
				관리자 대시보드에서 확인하기
			</a>
		</p>`,
	);

	return sendMail({ to: adminEmail, subject: `[ENERMADE] 새 견적요청: ${esc(contactName)}님`, html });
};

// ── 7. 샘플 요청 → 관리자 알림 ────────────────────────
/**
 * @param {{ contactName: string, contactEmail: string, companyName: string, productName: string, quantity: number, application: string, testCondition: string, id?: number }} payload
 */
exports.sendSampleRequestToAdmin = async (payload) => {
	const { contactName, contactEmail, companyName, productName, quantity, application, testCondition, id } = payload;
	const adminEmail =
		process.env.ADMIN_EMAIL ||
		process.env.EMAIL_FROM ||
		process.env.SMTP_USER;

	if (!adminEmail) return { ok: false, status: 'SKIPPED', error: '관리자 이메일 미설정' };
	if (!isConfigured()) return { ok: false, status: 'DISABLED', error: 'SMTP 미설정' };

	const html = wrapHtml(
		'새 샘플 요청이 접수되었습니다',
		`<p>새로운 샘플 요청이 웹사이트를 통해 접수되었습니다.</p>
		<table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;">
			<tr><td style="padding:8px 0;color:#666;width:120px;border-bottom:1px solid #f0f0f0;">담당자</td><td style="padding:8px 0;font-weight:600;border-bottom:1px solid #f0f0f0;">${esc(contactName)}</td></tr>
			<tr><td style="padding:8px 0;color:#666;border-bottom:1px solid #f0f0f0;">이메일</td><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;">${esc(contactEmail)}</td></tr>
			<tr><td style="padding:8px 0;color:#666;border-bottom:1px solid #f0f0f0;">회사명</td><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;">${esc(companyName || '(미입력)')}</td></tr>
			<tr><td style="padding:8px 0;color:#666;border-bottom:1px solid #f0f0f0;">상품명</td><td style="padding:8px 0;font-weight:600;border-bottom:1px solid #f0f0f0;">${esc(productName || '(미입력)')}</td></tr>
			<tr><td style="padding:8px 0;color:#666;border-bottom:1px solid #f0f0f0;">샘플 수량</td><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;">${Number(quantity)}개</td></tr>
			${id ? `<tr><td style="padding:8px 0;color:#666;">문의 ID</td><td style="padding:8px 0;">#${Number(id)}</td></tr>` : ''}
		</table>
		<p style="color:#444;font-size:14px;margin-top:8px;font-weight:600;">적용 장비/용도:</p>
		<div style="background:#fff3cd;border-left:4px solid #ffc107;padding:8px 16px;border-radius:4px;margin:8px 0;font-size:14px;line-height:1.7;">${escLines(application || '(미입력)')}</div>
		${testCondition ? `<p style="color:#444;font-size:14px;margin-top:12px;font-weight:600;">시험 조건:</p><div style="background:#fafafa;border:1px solid #eee;border-radius:4px;padding:12px 16px;margin:8px 0;font-size:14px;">${escLines(testCondition)}</div>` : ''}
		<p style="margin-top:20px;">
			<a href="${process.env.BASE_URL || 'http://localhost:3000'}/admin/inquiries"
			   style="background:#198754;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">
				관리자 대시보드에서 확인하기
			</a>
		</p>`,
	);

	return sendMail({ to: adminEmail, subject: `[ENERMADE] 새 샘플요청: ${esc(contactName)}님`, html });
};
