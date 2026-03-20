const express = require('express');
const csurf = require('../../lib/csurf');
const { fetchOrderDetailByNumber } = require('./helpers');
const asyncHandler = require('../../lib/asyncHandler');

const router = express.Router();
const guestOrderCsrf = csurf({ ignoreMethods: ['GET', 'HEAD', 'OPTIONS'] });

router.get('/orders/guest', guestOrderCsrf, (req, res) => {
	res.render('shop/order-lookup', {
		error: null,
		result: null,
		form: {
			orderNumber: '',
			guestEmail: '',
			guestPhone: '',
		},
	});
});

router.post('/orders/guest', guestOrderCsrf, asyncHandler(async (req, res) => {
	const orderNumber = String(req.body.orderNumber || '').trim();
	const guestEmail = String(req.body.guestEmail || '').trim();
	const guestPhone = String(req.body.guestPhone || '').trim();

	if (!orderNumber || (!guestEmail && !guestPhone)) {
		return res.render('shop/order-lookup', {
			error: '주문번호와 이메일 또는 연락처를 입력해주세요.',
			result: null,
			form: { orderNumber, guestEmail, guestPhone },
		});
	}

	const detail = await fetchOrderDetailByNumber(orderNumber);
	if (!detail?.order) {
		return res.render('shop/order-lookup', {
			error: '주문 정보를 찾을 수 없습니다.',
			result: null,
			form: { orderNumber, guestEmail, guestPhone },
		});
	}

	if (detail.order.user_id) {
		return res.render('shop/order-lookup', {
			error: '회원 주문은 로그인 후 주문 내역에서 확인해주세요.',
			result: null,
			form: { orderNumber, guestEmail, guestPhone },
		});
	}

	// 입력한 항목은 반드시 일치해야 함 (OR 허용 시 타인 주문 조회 가능)
	const emailMatch = !guestEmail || detail.order.guest_email === guestEmail;
	const phoneMatch = !guestPhone || detail.order.guest_phone === guestPhone;
	if (!emailMatch || !phoneMatch) {
		return res.render('shop/order-lookup', {
			error: '주문 정보가 일치하지 않습니다.',
			result: null,
			form: { orderNumber, guestEmail, guestPhone },
		});
	}

	return res.render('shop/order-detail', {
		order: detail.order,
		items: detail.items || [],
		payment: detail.payment,
		isGuestLookup: true,
	});
}));

router.get('/orders/:orderNumber', asyncHandler(async (req, res) => {
	const orderNumber = String(req.params.orderNumber || '').trim();
	const detail = await fetchOrderDetailByNumber(orderNumber);

	if (!detail?.order) {
		return res.status(404).render('404', { message: '주문을 찾을 수 없습니다.' });
	}

	if (!req.session.user || detail.order.user_id !== req.session.user.id) {
		return res.status(403).render('404', { message: '접근 권한이 없습니다.' });
	}

	return res.render('shop/order-detail', {
		order: detail.order,
		items: detail.items || [],
		payment: detail.payment,
		isGuestLookup: false,
	});
}));

module.exports = router;
