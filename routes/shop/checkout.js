const express = require('express');
const db = require('../../db');
const kakaoPayService = require('../../services/kakaopay.service');
const { getCartViewData, clearCart } = require('../../lib/cart');
const { createOrderFromCart, fetchOrderDetailByNumber } = require('./helpers');

const router = express.Router();

router.post('/checkout/kakao', async (req, res) => {
	try {
		if (!kakaoPayService.isConfigured()) {
			return res.status(500).send('카카오페이 설정이 필요합니다. 환경변수 KAKAO_ADMIN_KEY와 KAKAO_CID를 확인해주세요.');
		}

		const isGuest = !req.session.user;
		const guestName = isGuest ? String(req.body.guestName || '').trim() : null;
		const guestEmail = isGuest ? String(req.body.guestEmail || '').trim() : null;
		const guestPhone = isGuest ? String(req.body.guestPhone || '').trim() : null;

		const shippingName = String(req.body.shippingName || '').trim() || null;
		const shippingPhone = String(req.body.shippingPhone || '').trim() || null;
		const shippingAddress = String(req.body.shippingAddress || '').trim() || null;

		if (isGuest && (!guestName || (!guestEmail && !guestPhone))) {
			req.session.cartError = '비회원 주문은 이름과 이메일 또는 연락처가 필요합니다.';
			return res.redirect('/shop/cart');
		}

		if (isGuest) {
			req.session.guestOrderInfo = { guestName, guestEmail, guestPhone };
		}

		// 쿠폰 적용
		const appliedCoupon = req.session.appliedCoupon || null;
		let discountAmount = 0;
		let couponCode = null;
		if (appliedCoupon) {
			const cartData = await getCartViewData(req);
			discountAmount = Math.floor(cartData.totalAmount * (appliedCoupon.discount_pct / 100));
			couponCode = appliedCoupon.code;
		}

		const orderResult = await createOrderFromCart(req, { guestName, guestEmail, guestPhone, shippingName, shippingPhone, shippingAddress, discountAmount, couponCode });
		if (orderResult.error) {
			req.session.cartError = orderResult.error;
			return res.redirect('/shop/cart');
		}

		const itemName =
			orderResult.items.length === 1
				? orderResult.items[0].name
				: `${orderResult.items[0].name} 외 ${orderResult.items.length - 1}건`;
		const quantity = orderResult.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
		const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

		const readyResult = await kakaoPayService.ready({
			orderId: orderResult.orderNumber,
			userId: req.session.user?.id,
			itemName,
			quantity,
			totalAmount: orderResult.totalAmount,
			approvalUrl: `${baseUrl}/shop/checkout/kakao/approve`,
			cancelUrl: `${baseUrl}/shop/checkout/kakao/cancel`,
			failUrl: `${baseUrl}/shop/checkout/kakao/fail`,
		});

		await db.execute(
			`INSERT INTO order_payments (order_id, provider, tid, status, amount)
       VALUES (?, 'KAKAO', ?, 'READY', ?)`,
			[orderResult.orderId, readyResult.tid, orderResult.totalAmount],
		);

		req.session.kakaoPay = {
			tid: readyResult.tid,
			orderId: orderResult.orderId,
			orderNumber: orderResult.orderNumber,
			itemName,
			quantity,
			totalAmount: orderResult.totalAmount,
			items: orderResult.items,
		};

		return res.redirect(readyResult.next_redirect_pc_url);
	} catch (err) {
		console.error(err);
		return res.status(500).send('카카오페이 결제 준비 중 오류가 발생했습니다.');
	}
});

router.get('/checkout/kakao/approve', async (req, res) => {
	try {
		const pgToken = req.query.pg_token;
		const sessionPayment = req.session.kakaoPay;

		if (!pgToken || !sessionPayment) {
			return res.status(400).send('결제 승인 정보가 없습니다.');
		}

		const approvalResult = await kakaoPayService.approve({
			tid: sessionPayment.tid,
			orderId: sessionPayment.orderNumber,
			userId: req.session.user?.id,
			pgToken,
		});

		await db.execute(
			`UPDATE orders
       SET status = 'PAID'
       WHERE id = ?`,
			[sessionPayment.orderId],
		);

		await db.execute(
			`UPDATE order_payments
       SET status = 'APPROVED', approved_at = NOW()
       WHERE order_id = ? AND tid = ?`,
			[sessionPayment.orderId, sessionPayment.tid],
		);

		const detail = await fetchOrderDetailByNumber(sessionPayment.orderNumber);

		await clearCart(req);
		req.session.kakaoPay = null;
		req.session.appliedCoupon = null;

		return res.render('shop/order-complete', {
			order: detail?.order,
			items: detail?.items || [],
			payment: detail?.payment,
			approval: approvalResult,
		});
	} catch (err) {
		console.error(err);
		return res.status(500).render('shop/payment-fail', {
			message: '카카오페이 결제 승인 중 오류가 발생했습니다.',
		});
	}
});

router.get('/checkout/kakao/cancel', (req, res) => {
	if (req.session.kakaoPay?.orderId) {
		db.execute(`UPDATE orders SET status = 'CANCELED' WHERE id = ?`, [req.session.kakaoPay.orderId]).catch((err) =>
			console.error(err),
		);
		db.execute(
			`UPDATE order_payments SET status = 'CANCELED' WHERE order_id = ? AND tid = ?`,
			[req.session.kakaoPay.orderId, req.session.kakaoPay.tid],
		).catch((err) => console.error(err));
	}
	req.session.kakaoPay = null;
	return res.render('shop/payment-fail', {
		message: '카카오페이 결제가 취소되었습니다.',
	});
});

router.get('/checkout/kakao/fail', (req, res) => {
	if (req.session.kakaoPay?.orderId) {
		db.execute(`UPDATE orders SET status = 'FAILED' WHERE id = ?`, [req.session.kakaoPay.orderId]).catch((err) =>
			console.error(err),
		);
		db.execute(
			`UPDATE order_payments SET status = 'FAILED' WHERE order_id = ? AND tid = ?`,
			[req.session.kakaoPay.orderId, req.session.kakaoPay.tid],
		).catch((err) => console.error(err));
	}
	req.session.kakaoPay = null;
	return res.render('shop/payment-fail', {
		message: '카카오페이 결제에 실패했습니다. 다시 시도해주세요.',
	});
});

module.exports = router;
