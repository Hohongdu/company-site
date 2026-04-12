const inquiryService = require('../services/inquiry.service');
const { sendNewInquiryToAdmin } = require('../services/notification.service');
const { isValidEmail } = require('../lib/validators');

exports.create = async (req, res) => {
	try {
		const name = String(req.body?.name || '').trim();
		const email = String(req.body?.email || '').trim();
		const message = String(req.body?.message || '').trim();

		if (!name || !email || !message) {
			return res.status(400).json({ ok: false, message: '필수값 누락' });
		}
		if (!isValidEmail(email)) {
			return res.status(400).json({ ok: false, message: '이메일 형식 오류' });
		}
		if (name.length > 50) {
			return res.status(400).json({ ok: false, message: '이름이 너무 깁니다' });
		}

		const saved = await inquiryService.createInquiry({ name, email, message });

		// 관리자에게 이메일 알림 발송 (비동기 - 실패해도 응답에 영향 없음)
		sendNewInquiryToAdmin({ name, email, message, id: saved.id }).catch((err) => {
			console.error('[inquiry] admin notification failed:', err.message);
		});

		return res.json({ ok: true, id: saved.id });
	} catch (err) {
		console.error(err);
		return res.status(500).json({ ok: false, message: '문의 등록 중 오류가 발생했습니다.', code: 'INQUIRY_CREATE_ERROR' });
	}
};

exports.list = async (req, res) => {
	try {
		const limit = req.query?.limit;
		const offset = req.query?.offset;

		const rows = await inquiryService.listInquiries({ limit, offset });
		return res.json({ ok: true, data: rows });
	} catch (err) {
		console.error(err);
		return res.status(500).json({ ok: false, message: '문의 목록 조회 중 오류가 발생했습니다.', code: 'INQUIRY_LIST_ERROR' });
	}
};
