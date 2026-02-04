const express = require('express');
const bcrypt = require('bcrypt');
const csurf = require('csurf');
const db = require('../db');
const { getGuestCart, ensureUserCartId, getCartViewData, clearCart } = require('../lib/cart');
const kakaoPayService = require('../services/kakaopay.service');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
const accountCsrf = csurf({ ignoreMethods: ['GET', 'HEAD', 'OPTIONS'] });
const inquiryLookupCsrf = csurf({ ignoreMethods: ['GET', 'HEAD', 'OPTIONS'] });

async function ensureNotificationSettingsTable() {
	await db.execute(
		`CREATE TABLE IF NOT EXISTS user_notification_settings (
      user_id INT PRIMARY KEY,
      email_enabled TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
	);
}

function generateOrderNumber() {
	const rand = Math.floor(Math.random() * 1000)
		.toString()
		.padStart(3, '0');
	return `ORD-${Date.now()}-${rand}`;
}

async function createOrderFromCart(req, { guestName, guestEmail, guestPhone }) {
	const data = await getCartViewData(req);

	if (!data.items.length || !data.totalAmount) {
		return { error: '결제할 상품이 없습니다.' };
	}

	const orderNumber = generateOrderNumber();
	const userId = req.session.user?.id || null;

	const connection = await db.getConnection();
	try {
		await connection.beginTransaction();

		const [orderResult] = await connection.execute(
			`INSERT INTO orders
        (order_number, user_id, guest_name, guest_email, guest_phone, status, total_amount)
        VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`,
			[orderNumber, userId, guestName || null, guestEmail || null, guestPhone || null, data.totalAmount],
		);

		const orderId = orderResult.insertId;
		const insertItemSql = `
        INSERT INTO order_items
          (order_id, product_id, product_name, product_spec, product_image, unit_price, quantity, total_price)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;

		for (const item of data.items) {
			const quantity = Number(item.quantity) || 1;
			const unitPrice = Number(item.price) || 0;
			await connection.execute(insertItemSql, [
				orderId,
				item.product_id,
				item.name,
				item.spec || null,
				item.image || null,
				unitPrice,
				quantity,
				unitPrice * quantity,
			]);
		}

		await connection.commit();
		return { orderId, orderNumber, items: data.items, totalAmount: data.totalAmount };
	} catch (err) {
		await connection.rollback();
		throw err;
	} finally {
		connection.release();
	}
}

async function fetchOrderDetailByNumber(orderNumber) {
	const [[order]] = await db.execute('SELECT * FROM orders WHERE order_number = ? LIMIT 1', [orderNumber]);
	if (!order) return null;

	const [items] = await db.execute(
		`SELECT id, order_id, product_id, product_name, product_spec, product_image, unit_price, quantity, total_price
     FROM order_items
     WHERE order_id = ?
     ORDER BY id ASC`,
		[order.id],
	);

	const [[payment]] = await db.execute(
		`SELECT id, order_id, provider, tid, status, amount, requested_at, approved_at
     FROM order_payments
     WHERE order_id = ?
     ORDER BY id DESC
     LIMIT 1`,
		[order.id],
	);

	return { order, items, payment };
}

router.get('/', async (req, res) => {
	try {
		const [categories] = await db.execute('SELECT * FROM categories ORDER BY name ASC');
		const [latest] = await db.execute(`
      SELECT p.*, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      ORDER BY p.created_at DESC
      LIMIT 8
    `);

		res.render('shop/index', { categories, latest });
	} catch (err) {
		console.error(err);
		return res.redirect('/shop/products');
	}
});

router.get('/products', async (req, res) => {
	try {
		const categorySlug = req.query.category || 'all';
		const q = (req.query.q || '').trim();

		const [categories] = await db.execute('SELECT * FROM categories ORDER BY name ASC');

		let sql = `
      SELECT p.*, c.name AS category_name, c.slug AS category_slug
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
    `;
		const params = [];
		const where = [];

		if (categorySlug !== 'all') {
			where.push('c.slug = ?');
			params.push(categorySlug);
		}

		if (q) {
			where.push('(p.name LIKE ? OR p.code LIKE ? OR p.spec LIKE ?)');
			params.push(`%${q}%`, `%${q}%`, `%${q}%`);
		}

		if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
		sql += ' ORDER BY p.created_at DESC';

		const [products] = await db.execute(sql, params);

		res.render('shop/products', {
			products,
			categories,
			currentCategory: categorySlug,
			query: q,
		});
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 목록 오류');
	}
});

router.get('/products/:id', async (req, res) => {
	try {
		const productId = Number(req.params.id);

		const [rows] = await db.execute(
			`
      SELECT p.*, c.name AS category_name, c.slug AS category_slug
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = ? LIMIT 1
      `,
			[productId]
		);

		if (!rows.length) return res.status(404).render('404', { message: '상품을 찾을 수 없습니다.' });
		res.render('shop/product-detail', { product: rows[0] });
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 상세 오류');
	}
});

// cart view
router.get('/cart', async (req, res) => {
	try {
		const data = await getCartViewData(req);
		const paymentEnabled = kakaoPayService.isConfigured();
		const cartError = req.session.cartError || null;
		req.session.cartError = null;

		res.render('shop/cart', {
			...data,
			paymentEnabled,
			guestInfo: req.session.guestOrderInfo || {},
			cartError,
		});
	} catch (err) {
		console.error(err);
		res.status(500).send('장바구니 오류');
	}
});

// cart add
router.post('/cart/add', async (req, res) => {
	try {
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
	} catch (err) {
		console.error(err);
		res.status(500).send('장바구니 담기 오류');
	}
});

// cart update
router.post('/cart/update', async (req, res) => {
	try {
		const productId = Number(req.body.productId);
		const quantity = Math.max(1, Number(req.body.quantity) || 1);

		if (req.session.user) {
			const cartItemId = Number(req.body.cartItemId);
			await db.execute('UPDATE cart_items SET quantity = ? WHERE id = ?', [quantity, cartItemId]);
			return res.redirect('/shop/cart');
		}

		const guestCart = getGuestCart(req);
		if (guestCart.items[productId]) guestCart.items[productId] = quantity;
		return res.redirect('/shop/cart');
	} catch (err) {
		console.error(err);
		res.status(500).send('장바구니 수정 오류');
	}
});

// cart remove
router.post('/cart/remove', async (req, res) => {
	try {
		const productId = Number(req.body.productId);

		if (req.session.user) {
			const cartItemId = Number(req.body.cartItemId);
			await db.execute('DELETE FROM cart_items WHERE id = ?', [cartItemId]);
			return res.redirect('/shop/cart');
		}

		const guestCart = getGuestCart(req);
		delete guestCart.items[productId];
		return res.redirect('/shop/cart');
	} catch (err) {
		console.error(err);
		res.status(500).send('장바구니 삭제 오류');
	}
});

// cart clear
router.post('/cart/clear', async (req, res) => {
	try {
		if (req.session.user) {
			const cartId = await ensureUserCartId(req.session.user.id);
			await db.execute('DELETE FROM cart_items WHERE cart_id = ?', [cartId]);
			return res.redirect('/shop/cart');
		}
		req.session.guestCart = { items: {} };
		return res.redirect('/shop/cart');
	} catch (err) {
		console.error(err);
		res.status(500).send('장바구니 비우기 오류');
	}
});

router.post('/checkout/kakao', async (req, res) => {
	try {
		if (!kakaoPayService.isConfigured()) {
			return res.status(500).send('카카오페이 설정이 필요합니다. 환경변수 KAKAO_ADMIN_KEY와 KAKAO_CID를 확인해주세요.');
		}

		const isGuest = !req.session.user;
		const guestName = isGuest ? String(req.body.guestName || '').trim() : null;
		const guestEmail = isGuest ? String(req.body.guestEmail || '').trim() : null;
		const guestPhone = isGuest ? String(req.body.guestPhone || '').trim() : null;

		if (isGuest && (!guestName || (!guestEmail && !guestPhone))) {
			req.session.cartError = '비회원 주문은 이름과 이메일 또는 연락처가 필요합니다.';
			return res.redirect('/shop/cart');
		}

		if (isGuest) {
			req.session.guestOrderInfo = { guestName, guestEmail, guestPhone };
		}

		const orderResult = await createOrderFromCart(req, { guestName, guestEmail, guestPhone });
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

router.get('/orders/guest', (req, res) => {
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

router.post('/orders/guest', async (req, res) => {
	try {
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

		if (detail.order.guest_email !== guestEmail && detail.order.guest_phone !== guestPhone) {
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
	} catch (err) {
		console.error(err);
		return res.status(500).send('주문 조회 중 오류가 발생했습니다.');
	}
});

router.get('/orders/:orderNumber', async (req, res) => {
	try {
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
	} catch (err) {
		console.error(err);
		return res.status(500).send('주문 상세 조회 오류');
	}
});

router.get('/account', requireLogin, accountCsrf, async (req, res) => {
	try {
		const userId = req.session.user.id;
		await ensureNotificationSettingsTable();
		const [[user]] = await db.execute('SELECT id, name, email FROM users WHERE id = ? LIMIT 1', [userId]);
		const [[notificationRow]] = await db.execute(
			`SELECT email_enabled
       FROM user_notification_settings
       WHERE user_id = ?
       LIMIT 1`,
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
			return res.status(400).send('주문 정보가 올바르지 않습니다.');
		}

		const [[order]] = await db.execute(
			`SELECT id, status
       FROM orders
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
			[orderId, userId],
		);

		if (!order) {
			return res.status(404).send('주문 정보를 찾을 수 없습니다.');
		}

		if (order.status !== 'PENDING') {
			return res.redirect('/shop/account/orders');
		}

		await db.execute('UPDATE orders SET status = ? WHERE id = ?', ['CANCEL_REQUESTED', orderId]);
		return res.redirect('/shop/account/orders');
	} catch (err) {
		console.error(err);
		return res.status(500).send('주문 취소 요청 중 오류가 발생했습니다.');
	}
});

router.post('/account/delete', requireLogin, accountCsrf, async (req, res) => {
	const userId = req.session.user.id;
	const connection = await db.getConnection();
	try {
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

		await connection.execute('DELETE FROM user_notification_settings WHERE user_id = ?', [userId]);
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

router.get('/inquiries', (req, res) => {
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

router.post('/inquiries/guest', inquiryLookupCsrf, async (req, res) => {
	try {
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
	} catch (err) {
		console.error(err);
		return res.status(500).send('문의 조회 중 오류가 발생했습니다.');
	}
});

router.post('/inquiries', async (req, res) => {
	try {
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
			const [[order]] = await db.execute('SELECT id FROM orders WHERE order_number = ? LIMIT 1', [orderNumber]);
			orderId = order?.id || null;
		}

		await db.execute(
			`INSERT INTO inquiries (order_id, user_id, guest_name, guest_email, guest_phone, title, content, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'NEW')`,
			[orderId, req.session.user?.id || null, guestName, guestEmail, guestPhone, title, content],
		);

		return res.redirect('/shop/inquiries?ok=1');
	} catch (err) {
		console.error(err);
		return res.status(500).send('문의 등록 중 오류가 발생했습니다.');
	}
});

module.exports = router;
