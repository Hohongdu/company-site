const express = require('express');
const csurf = require('../../lib/csurf');
const db = require('../../db');
const { getGuestCart, ensureUserCartId, getCartViewData } = require('../../lib/cart');
const kakaoPayService = require('../../services/kakaopay.service');
const { requireLogin } = require('../../middleware/auth');
const { ensureCouponTable } = require('../../lib/migrations');
const asyncHandler = require('../../lib/asyncHandler');

const router = express.Router();
const cartCsrf = csurf({ ignoreMethods: ['GET', 'HEAD', 'OPTIONS'] });

// cart view
router.get('/cart', asyncHandler(async (req, res) => {
	const data = await getCartViewData(req);
	const paymentEnabled = kakaoPayService.isConfigured();
	const cartError = req.session.cartError || null;
	req.session.cartError = null;

	const appliedCoupon = req.session.appliedCoupon || null;
	const discountAmount = appliedCoupon ? Math.floor(data.totalAmount * (appliedCoupon.discount_pct / 100)) : 0;

	res.render('shop/cart', {
		...data,
		paymentEnabled,
		guestInfo: req.session.guestOrderInfo || {},
		cartError,
		appliedCoupon,
		discountAmount,
		finalAmount: Math.max(0, data.totalAmount - discountAmount),
	});
}));

// 쿠폰 적용
router.post('/cart/coupon', requireLogin, cartCsrf, asyncHandler(async (req, res) => {
	await ensureCouponTable();
	const code = String(req.body.couponCode || '').trim().toUpperCase();
	if (!code) {
		req.session.cartError = '쿠폰 코드를 입력해주세요.';
		return res.redirect('/shop/cart');
	}

	const [[coupon]] = await db.execute(
		`SELECT * FROM user_coupons
       WHERE user_id = ? AND code = ?
         AND (expires_at IS NULL OR expires_at >= CURDATE())
       LIMIT 1`,
		[req.session.user.id, code],
	);

	if (!coupon) {
		req.session.cartError = '유효하지 않거나 만료된 쿠폰입니다.';
		return res.redirect('/shop/cart');
	}

	req.session.appliedCoupon = coupon;
	return res.redirect('/shop/cart');
}));

// 쿠폰 제거
router.post('/cart/coupon/remove', cartCsrf, (req, res) => {
	req.session.appliedCoupon = null;
	return res.redirect('/shop/cart');
});

// cart add
router.post('/cart/add', cartCsrf, asyncHandler(async (req, res) => {
	const productId = Number(req.body.productId);
	const quantity = Math.max(1, Number(req.body.quantity) || 1);
	if (!productId) return res.status(400).send('상품 정보가 올바르지 않습니다.');

	if (req.session.user) {
		const cartId = await ensureUserCartId(req.session.user.id);

		const [exist] = await db.execute('SELECT id FROM cart_items WHERE cart_id = ? AND product_id = ? LIMIT 1', [cartId, productId]);

		if (exist.length) {
			await db.execute('UPDATE cart_items SET quantity = quantity + ? WHERE id = ?', [quantity, exist[0].id]);
		} else {
			await db.execute('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)', [cartId, productId, quantity]);
		}

		return res.redirect('/shop/cart');
	}

	const guestCart = getGuestCart(req);
	guestCart.items[productId] = (Number(guestCart.items[productId]) || 0) + quantity;
	return res.redirect('/shop/cart');
}));

// cart update
router.post('/cart/update', cartCsrf, asyncHandler(async (req, res) => {
	const productId = Number(req.body.productId);
	const quantity = Math.max(1, Number(req.body.quantity) || 1);

	if (req.session.user) {
		const cartItemId = Number(req.body.cartItemId);
		const userId = req.session.user.id;
		// H-10: 소유권 검증 — 본인 cart_items만 수정 가능
		await db.execute(
			'UPDATE cart_items SET quantity = ? WHERE id = ? AND cart_id = (SELECT id FROM carts WHERE user_id = ? LIMIT 1)',
			[quantity, cartItemId, userId],
		);
		return res.redirect('/shop/cart');
	}

	const guestCart = getGuestCart(req);
	if (guestCart.items[productId]) guestCart.items[productId] = quantity;
	return res.redirect('/shop/cart');
}));

// cart remove
router.post('/cart/remove', cartCsrf, asyncHandler(async (req, res) => {
	const productId = Number(req.body.productId);

	if (req.session.user) {
		const cartItemId = Number(req.body.cartItemId);
		const userId = req.session.user.id;
		// H-3: 소유권 검증 — 본인 cart_items만 삭제 가능
		await db.execute(
			'DELETE FROM cart_items WHERE id = ? AND cart_id = (SELECT id FROM carts WHERE user_id = ? LIMIT 1)',
			[cartItemId, userId],
		);
		return res.redirect('/shop/cart');
	}

	const guestCart = getGuestCart(req);
	delete guestCart.items[productId];
	return res.redirect('/shop/cart');
}));

// cart clear
router.post('/cart/clear', cartCsrf, asyncHandler(async (req, res) => {
	if (req.session.user) {
		const cartId = await ensureUserCartId(req.session.user.id);
		await db.execute('DELETE FROM cart_items WHERE cart_id = ?', [cartId]);
		return res.redirect('/shop/cart');
	}
	req.session.guestCart = { items: {} };
	return res.redirect('/shop/cart');
}));

module.exports = router;
