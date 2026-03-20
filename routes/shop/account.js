const express = require('express');
const bcrypt = require('bcrypt');
const csurf = require('../../lib/csurf');
const db = require('../../db');
const { requireLogin } = require('../../middleware/auth');
const {
	ensureNotificationSettingsTable,
	ensureAddressTable,
	ensurePaymentMethodTable,
	ensureCouponTable,
	ensureWishlistTable,
	ensureReviewTable,
	ensureOrderStatusEnum,
} = require('../../lib/migrations');
const { renderShopError } = require('./helpers');

const router = express.Router();
const accountCsrf = csurf({ ignoreMethods: ['GET', 'HEAD', 'OPTIONS'] });

router.get('/account', requireLogin, accountCsrf, async (req, res) => {
	try {
		const userId = req.session.user.id;
		await ensureNotificationSettingsTable();
		await ensureAddressTable();
		await ensurePaymentMethodTable();
		await ensureCouponTable();
		const [[user]] = await db.execute('SELECT id, name, email FROM users WHERE id = ? LIMIT 1', [userId]);
		const [[notificationRow]] = await db.execute(
			`SELECT email_enabled
       FROM user_notification_settings
       WHERE user_id = ?
       LIMIT 1`,
			[userId],
		);
		const [addresses] = await db.execute(
			`SELECT id, label, recipient_name, phone, address_line1, address_line2, postal_code
       FROM user_addresses
       WHERE user_id = ?
       ORDER BY id DESC`,
			[userId],
		);
		const [paymentMethods] = await db.execute(
			`SELECT id, label, provider, last4
       FROM user_payment_methods
       WHERE user_id = ?
       ORDER BY id DESC`,
			[userId],
		);
		const [coupons] = await db.execute(
			`SELECT id, code, description, discount_pct, expires_at
       FROM user_coupons
       WHERE user_id = ?
       ORDER BY id DESC`,
			[userId],
		);

		if (!user) {
			return res.status(404).render('404', { message: '사용자 정보를 찾을 수 없습니다.' });
		}

		return res.render('shop/account', {
			user,
			active: 'account',
			message: req.query?.message || null,
			error: req.query?.error || null,
			csrfToken: req.csrfToken(),
			emailNotificationEnabled: notificationRow ? Boolean(notificationRow.email_enabled) : true,
			addresses,
			paymentMethods,
			coupons,
		});
	} catch (err) {
		console.error(err);
		return res.status(500).send('내 정보 로딩 중 오류가 발생했습니다.');
	}
});

router.post('/account/profile', requireLogin, accountCsrf, async (req, res) => {
	try {
		const userId = req.session.user.id;
		const name = String(req.body.name || '').trim();
		const email = String(req.body.email || '').trim().toLowerCase();
		const password = String(req.body.password || '').trim();
		const passwordConfirm = String(req.body.passwordConfirm || '').trim();

		if (!name || !email) {
			return res.redirect('/shop/account?error=이름과 이메일을 입력해주세요.');
		}

		// M-3: 이메일 형식 검증
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(email)) {
			return res.redirect('/shop/account?error=올바른 이메일 형식을 입력해주세요.');
		}

		const [[existing]] = await db.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
		if (existing && existing.id !== userId) {
			return res.redirect('/shop/account?error=이미 사용 중인 이메일입니다.');
		}

		if (password && password !== passwordConfirm) {
			return res.redirect('/shop/account?error=비밀번호가 일치하지 않습니다.');
		}

		if (password) {
			const hashedPw = await bcrypt.hash(password, 10);
			await db.execute('UPDATE users SET name = ?, email = ?, password = ? WHERE id = ?', [name, email, hashedPw, userId]);
		} else {
			await db.execute('UPDATE users SET name = ?, email = ? WHERE id = ?', [name, email, userId]);
		}

		req.session.user.name = name;
		req.session.user.email = email;

		return res.redirect('/shop/account?message=내 정보가 업데이트되었습니다.');
	} catch (err) {
		console.error(err);
		return res.status(500).send('내 정보 수정 중 오류가 발생했습니다.');
	}
});

router.post('/account/notifications', requireLogin, accountCsrf, async (req, res) => {
	try {
		const userId = req.session.user.id;
		const emailEnabled = req.body.emailNotifications === 'on' ? 1 : 0;

		await ensureNotificationSettingsTable();
		await db.execute(
			`INSERT INTO user_notification_settings (user_id, email_enabled)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE email_enabled = VALUES(email_enabled)`,
			[userId, emailEnabled],
		);

		return res.redirect('/shop/account?message=알림 설정이 저장되었습니다.');
	} catch (err) {
		console.error(err);
		return res.status(500).send('알림 설정 저장 중 오류가 발생했습니다.');
	}
});

router.post('/account/addresses', requireLogin, accountCsrf, async (req, res) => {
	try {
		const userId = req.session.user.id;
		const label = String(req.body.label || '').trim();
		const recipientName = String(req.body.recipientName || '').trim();
		const phone = String(req.body.phone || '').trim();
		const addressLine1 = String(req.body.addressLine1 || '').trim();
		const addressLine2 = String(req.body.addressLine2 || '').trim();
		const postalCode = String(req.body.postalCode || '').trim();

		if (!recipientName || !addressLine1) {
			return res.redirect('/shop/account?error=배송지 정보를 입력해주세요.');
		}

		await ensureAddressTable();
		await db.execute(
			`INSERT INTO user_addresses
       (user_id, label, recipient_name, phone, address_line1, address_line2, postal_code)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[userId, label || null, recipientName, phone || null, addressLine1, addressLine2 || null, postalCode || null],
		);

		return res.redirect('/shop/account?message=배송지가 추가되었습니다.');
	} catch (err) {
		console.error(err);
		return res.status(500).send('배송지 저장 중 오류가 발생했습니다.');
	}
});

router.post('/account/addresses/:id/delete', requireLogin, accountCsrf, async (req, res) => {
	try {
		const userId = req.session.user.id;
		const addressId = Number(req.params.id);
		if (!addressId) return res.redirect('/shop/account');

		await db.execute(`DELETE FROM user_addresses WHERE id = ? AND user_id = ?`, [addressId, userId]);
		return res.redirect('/shop/account?message=배송지가 삭제되었습니다.');
	} catch (err) {
		console.error(err);
		return res.status(500).send('배송지 삭제 중 오류가 발생했습니다.');
	}
});

router.post('/account/payments', requireLogin, accountCsrf, async (req, res) => {
	try {
		const userId = req.session.user.id;
		const label = String(req.body.label || '').trim();
		const provider = String(req.body.provider || '').trim();
		const last4 = String(req.body.last4 || '').trim();

		if (!provider || !last4) {
			return res.redirect('/shop/account?error=결제수단 정보를 입력해주세요.');
		}

		await ensurePaymentMethodTable();
		await db.execute(
			`INSERT INTO user_payment_methods (user_id, label, provider, last4)
       VALUES (?, ?, ?, ?)`,
			[userId, label || null, provider, last4],
		);

		return res.redirect('/shop/account?message=결제수단이 저장되었습니다.');
	} catch (err) {
		console.error(err);
		return res.status(500).send('결제수단 저장 중 오류가 발생했습니다.');
	}
});

router.post('/account/payments/:id/delete', requireLogin, accountCsrf, async (req, res) => {
	try {
		const userId = req.session.user.id;
		const paymentId = Number(req.params.id);
		if (!paymentId) return res.redirect('/shop/account');

		await db.execute(`DELETE FROM user_payment_methods WHERE id = ? AND user_id = ?`, [paymentId, userId]);
		return res.redirect('/shop/account?message=결제수단이 삭제되었습니다.');
	} catch (err) {
		console.error(err);
		return res.status(500).send('결제수단 삭제 중 오류가 발생했습니다.');
	}
});

router.post('/account/coupons', requireLogin, accountCsrf, async (req, res) => {
	try {
		const userId = req.session.user.id;
		const code = String(req.body.code || '').trim();
		const description = String(req.body.description || '').trim();
		// M-4: discount_pct 0~100 범위 제한 (비즈니스 로직 보호)
		const rawDiscount = Number(req.body.discountPct || 0);
		const discountPct = Math.min(100, Math.max(0, rawDiscount));
		const expiresAt = String(req.body.expiresAt || '').trim();

		if (!code) {
			return res.redirect('/shop/account?error=쿠폰 코드를 입력해주세요.');
		}

		await ensureCouponTable();
		await db.execute(
			`INSERT INTO user_coupons (user_id, code, description, discount_pct, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
			[userId, code, description || null, discountPct, expiresAt || null],
		);

		return res.redirect('/shop/account?message=쿠폰이 등록되었습니다.');
	} catch (err) {
		console.error(err);
		return res.status(500).send('쿠폰 등록 중 오류가 발생했습니다.');
	}
});

router.get('/account/inquiries', requireLogin, accountCsrf, async (req, res) => {
	try {
		const userId = req.session.user.id;
		const [inquiries] = await db.execute(
			`SELECT i.*
       FROM inquiries i
       WHERE i.user_id = ?
       ORDER BY i.created_at DESC`,
			[userId],
		);

		return res.render('shop/account-inquiries', {
			inquiries,
			active: 'account',
			csrfToken: req.csrfToken(),
		});
	} catch (err) {
		console.error(err);
		return res.status(500).send('문의 내역 로딩 중 오류가 발생했습니다.');
	}
});

router.get('/account/orders', requireLogin, accountCsrf, async (req, res) => {
	try {
		const userId = req.session.user.id;
		const [orders] = await db.execute(
			`SELECT id, order_number, status, total_amount, created_at
       FROM orders
       WHERE user_id = ?
       ORDER BY created_at DESC`,
			[userId],
		);

		return res.render('shop/account-orders', {
			orders,
			active: 'account',
			csrfToken: req.csrfToken(),
		});
	} catch (err) {
		console.error(err);
		return res.status(500).send('주문 내역 로딩 중 오류가 발생했습니다.');
	}
});

router.post('/account/orders/:orderId/cancel', requireLogin, accountCsrf, async (req, res) => {
	try {
		const orderId = Number(req.params.orderId);
		const userId = req.session.user.id;

		if (!orderId) {
			return renderShopError(res, '주문 정보가 올바르지 않습니다.', 400);
		}

		const [[order]] = await db.execute(
			`SELECT id, status
       FROM orders
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
			[orderId, userId],
		);

		if (!order) {
			return renderShopError(res, '주문 정보를 찾을 수 없습니다.', 404);
		}

		const cancellable = ['PENDING', 'PAID'];
		if (!cancellable.includes(order.status)) {
			return res.redirect('/shop/account/orders?error=' + encodeURIComponent('이미 처리된 주문은 취소 요청할 수 없습니다.'));
		}

		await ensureOrderStatusEnum();
		await db.execute('UPDATE orders SET status = ? WHERE id = ?', ['CANCEL_REQUESTED', orderId]);
		return res.redirect('/shop/account/orders?notice=' + encodeURIComponent('취소 요청이 접수되었습니다.'));
	} catch (err) {
		console.error(err);
		return renderShopError(res, '주문 취소 요청 중 오류가 발생했습니다.', 500);
	}
});

router.post('/account/delete', requireLogin, accountCsrf, async (req, res) => {
	const userId = req.session.user.id;
	const connection = await db.getConnection();
	try {
		await ensureAddressTable();
		await ensurePaymentMethodTable();
		await ensureCouponTable();
		await ensureWishlistTable();
		await ensureReviewTable();
		await ensureNotificationSettingsTable();
		const [[user]] = await connection.execute('SELECT name, email FROM users WHERE id = ? LIMIT 1', [userId]);

		if (!user) {
			return res.status(404).send('사용자 정보를 찾을 수 없습니다.');
		}

		await connection.beginTransaction();

		await connection.execute(
			`UPDATE orders
       SET user_id = NULL,
           guest_name = ?,
           guest_email = ?
       WHERE user_id = ?`,
			[user.name, user.email, userId],
		);

		await connection.execute(
			`UPDATE inquiries
       SET user_id = NULL,
           guest_name = ?,
           guest_email = ?
       WHERE user_id = ?`,
			[user.name, user.email, userId],
		);

		await connection.execute('DELETE FROM user_addresses WHERE user_id = ?', [userId]);
		await connection.execute('DELETE FROM user_payment_methods WHERE user_id = ?', [userId]);
		await connection.execute('DELETE FROM user_notification_settings WHERE user_id = ?', [userId]);
		await connection.execute('DELETE FROM user_coupons WHERE user_id = ?', [userId]);
		await connection.execute('DELETE FROM user_wishlist WHERE user_id = ?', [userId]);
		await connection.execute('DELETE FROM product_reviews WHERE user_id = ?', [userId]);
		await connection.execute('DELETE FROM users WHERE id = ?', [userId]);
		await connection.commit();

		req.session.destroy(() => {
			res.redirect('/?deleted=1');
		});
	} catch (err) {
		await connection.rollback();
		console.error(err);
		return res.status(500).send('회원 탈퇴 처리 중 오류가 발생했습니다.');
	} finally {
		connection.release();
	}
});

module.exports = router;
