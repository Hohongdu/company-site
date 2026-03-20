const express = require('express');
const csurf = require('../../lib/csurf');
const db = require('../../db');
const asyncHandler = require('../../lib/asyncHandler');

const router = express.Router();
const inquiryLookupCsrf = csurf({ ignoreMethods: ['GET', 'HEAD', 'OPTIONS'] });

router.get('/inquiries', inquiryLookupCsrf, (req, res) => {
	res.render('shop/inquiry', {
		form: {
			orderNumber: '',
			title: '',
			content: '',
			guestName: '',
			guestEmail: '',
			guestPhone: '',
		},
		success: req.query?.ok === '1',
		error: null,
	});
});

router.get('/inquiries/guest', inquiryLookupCsrf, (req, res) => {
	res.render('shop/inquiry-lookup', {
		form: {
			inquiryId: '',
			guestEmail: '',
			guestPhone: '',
		},
		error: null,
		result: null,
		csrfToken: req.csrfToken(),
	});
});

router.post('/inquiries/guest', inquiryLookupCsrf, asyncHandler(async (req, res) => {
	const inquiryId = Number(req.body.inquiryId);
	const guestEmail = String(req.body.guestEmail || '').trim();
	const guestPhone = String(req.body.guestPhone || '').trim();

	if (!inquiryId || (!guestEmail && !guestPhone)) {
		return res.render('shop/inquiry-lookup', {
			form: { inquiryId, guestEmail, guestPhone },
			error: '문의 번호와 이메일 또는 연락처를 입력해주세요.',
			result: null,
			csrfToken: req.csrfToken(),
		});
	}

	const [[inquiry]] = await db.execute(
		`SELECT *
       FROM inquiries
       WHERE id = ?
         AND user_id IS NULL
         AND ((guest_email = ? AND guest_email IS NOT NULL) OR (guest_phone = ? AND guest_phone IS NOT NULL))
       LIMIT 1`,
		[inquiryId, guestEmail || null, guestPhone || null],
	);

	if (!inquiry) {
		return res.render('shop/inquiry-lookup', {
			form: { inquiryId, guestEmail, guestPhone },
			error: '문의 내역을 찾을 수 없습니다.',
			result: null,
			csrfToken: req.csrfToken(),
		});
	}

	return res.render('shop/inquiry-lookup', {
		form: { inquiryId, guestEmail, guestPhone },
		error: null,
		result: inquiry,
		csrfToken: req.csrfToken(),
	});
}));

router.post('/inquiries', inquiryLookupCsrf, asyncHandler(async (req, res) => {
	const orderNumber = String(req.body.orderNumber || '').trim();
	const title = String(req.body.title || '').trim();
	const content = String(req.body.content || '').trim();

	const isGuest = !req.session.user;
	const guestName = isGuest ? String(req.body.guestName || '').trim() : req.session.user?.name || null;
	const guestEmail = isGuest ? String(req.body.guestEmail || '').trim() : req.session.user?.email || null;
	const guestPhone = isGuest ? String(req.body.guestPhone || '').trim() : null;

	if (!title || !content) {
		return res.render('shop/inquiry', {
			form: { orderNumber, title, content, guestName, guestEmail, guestPhone },
			success: false,
			error: '문의 제목과 내용을 입력해주세요.',
		});
	}

	if (isGuest && (!guestName || (!guestEmail && !guestPhone))) {
		return res.render('shop/inquiry', {
			form: { orderNumber, title, content, guestName, guestEmail, guestPhone },
			success: false,
			error: '비회원 문의는 이름과 이메일 또는 연락처가 필요합니다.',
		});
	}

	let orderId = null;
	if (orderNumber) {
		// M-7: orderNumber 형식 검증 — 영숫자 하이픈만 허용, 최대 30자
		if (!/^[A-Za-z0-9\-]{1,30}$/.test(orderNumber)) {
			return res.render('shop/inquiry', {
				form: { orderNumber, title, content, guestName, guestEmail, guestPhone },
				success: false,
				error: '올바른 주문번호 형식이 아닙니다.',
			});
		}
		const [[order]] = await db.execute('SELECT id FROM orders WHERE order_number = ? LIMIT 1', [orderNumber]);
		orderId = order?.id || null;
	}

	await db.execute(
		`INSERT INTO inquiries (order_id, user_id, guest_name, guest_email, guest_phone, title, content, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'NEW')`,
		[orderId, req.session.user?.id || null, guestName, guestEmail, guestPhone, title, content],
	);

	return res.redirect('/shop/inquiries?ok=1');
}));

module.exports = router;
