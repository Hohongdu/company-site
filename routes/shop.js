const express = require('express');
// [P0 버그수정] bcrypt 제거 주석이 잘못됨 — /account/profile 비밀번호 변경에서 실제 사용 중
const bcrypt = require('bcrypt');
const crypto = require('crypto');       // [H-3] 주문번호 CSPRNG 생성에 사용
const rateLimit = require('express-rate-limit');
const csurf = require('../lib/csurf');
const db = require('../db');
const { getGuestCart, ensureUserCartId, getCartViewData, clearCart } = require('../lib/cart');
const kakaoPayService = require('../services/kakaopay.service');
const { requireLogin } = require('../middleware/auth');
const searchLogService = require('../services/search-log.service');

const { isValidEmail } = require('../lib/validators');

const router = express.Router();
const accountCsrf = csurf({ ignoreMethods: ['GET', 'HEAD', 'OPTIONS'] });
const inquiryLookupCsrf = csurf({ ignoreMethods: ['GET', 'HEAD', 'OPTIONS'] });

// [HIGH-5] 카카오페이 결제 시작 rate limiter: IP당 1분 5회 — 재고 잠금(PENDING) 남발 방지
const kakaoCheckoutLimiter = rateLimit({
	windowMs: 60 * 1000,
	max: 5,
	standardHeaders: 'draft-7',
	legacyHeaders: false,
	message: { ok: false, message: '잠시 후 다시 시도해 주세요.' },
});

// [MED-1] 비회원 주문조회 브루트포스 방지: 1시간 내 IP당 10회 초과 시 차단
// 주문번호 열거 공격으로 고객 PII 노출 방지
const guestOrderLookupLimiter = rateLimit({
	windowMs: 60 * 60 * 1000,
	max: 10,
	standardHeaders: 'draft-7',
	legacyHeaders: false,
	handler: (req, res) => {
		res.status(429).render('shop/order-lookup', {
			error: '조회 횟수가 너무 많습니다. 1시간 후 다시 시도해주세요.',
			result: null,
			form: req.body || {},
		});
	},
});

// [M-3] 비회원 문의 스팸 방지: 1시간 내 IP당 5회 초과 시 차단
const shopInquiryLimiter = rateLimit({
	windowMs: 60 * 60 * 1000,
	max: 5,
	standardHeaders: 'draft-7',
	legacyHeaders: false,
	handler: (req, res) => {
		res.status(429).render('shop/inquiry', {
			form: req.body || {},
			success: false,
			error: '문의 제출 횟수가 너무 많습니다. 1시간 후 다시 시도해주세요.',
		});
	},
});

const renderShopError = (req, res, message, status = 500, backHref = req.get('referer') || '/shop') =>
	res.status(status).render('error', {
		statusCode: status,
		message,
		backHref,
	});

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

async function ensureWishlistTable() {
	await db.execute(
		`CREATE TABLE IF NOT EXISTS user_wishlist (
      user_id INT NOT NULL,
      product_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, product_id)
    )`,
	);
}

async function ensureReviewTable() {
	await db.execute(
		`CREATE TABLE IF NOT EXISTS product_reviews (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      user_id INT NOT NULL,
      rating INT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
	);
}

async function ensureProductVisibilityColumn() {
	try {
		await db.execute(`ALTER TABLE products ADD COLUMN visibility_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'`);
	} catch (err) {
		if (!String(err?.message || '').includes('Duplicate column')) throw err;
	}
}

async function ensureAddressTable() {
	await db.execute(
		`CREATE TABLE IF NOT EXISTS user_addresses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      label VARCHAR(80),
      recipient_name VARCHAR(80),
      phone VARCHAR(30),
      address_line1 VARCHAR(255),
      address_line2 VARCHAR(255),
      postal_code VARCHAR(20),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
	);
}

async function ensurePaymentMethodTable() {
	await db.execute(
		`CREATE TABLE IF NOT EXISTS user_payment_methods (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      label VARCHAR(80),
      provider VARCHAR(50),
      last4 VARCHAR(4),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
	);
}

async function ensureOrderStatusEnum() {
	try {
		await db.execute(
			`ALTER TABLE orders MODIFY status ENUM('PENDING','PAID','CANCELED','FAILED','CANCEL_REQUESTED') NOT NULL DEFAULT 'PENDING'`,
		);
	} catch (err) {
		const message = String(err?.message || '');
		if (!message.includes('Duplicate') && !message.includes('Data truncated')) {
			throw err;
		}
	}
}

async function ensureCouponTable() {
	await db.execute(
		`CREATE TABLE IF NOT EXISTS user_coupons (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      code VARCHAR(50) NOT NULL,
      description VARCHAR(255),
      discount_pct INT DEFAULT 0,
      expires_at DATE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
	);
}

router.initializeSchema = async function initializeSchema() {
	await ensureProductVisibilityColumn();
	await ensureReviewTable();
	await ensureWishlistTable();
	await ensureNotificationSettingsTable();
	await ensureAddressTable();
	await ensurePaymentMethodTable();
	await ensureCouponTable();
};

function generateOrderNumber() {
	// [H-3] Math.random() → crypto.randomBytes(): 예측 불가능한 CSPRNG 사용
	// Math.random은 시드 예측 가능 → 공격자가 주문번호 열거 공격 가능
	// crypto.randomBytes(4).toString('hex') = 8자리 16진수 (약 42억 가지 경우의 수)
	const rand = crypto.randomBytes(4).toString('hex');
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
		await connection.execute('SET SESSION innodb_lock_wait_timeout = 5');

		// [C-3] 재고 검증 + FOR UPDATE 락: 트랜잭션 내에서 최신 가격/재고 확인
		// SELECT ... FOR UPDATE로 동시 주문 경쟁 시 첫 번째 트랜잭션이 완료될 때까지 다른 트랜잭션 대기
		const productIds = data.items.map(item => item.product_id);
		const placeholders = productIds.map(() => '?').join(',');
		const [lockedProducts] = await connection.execute(
			`SELECT id, name, price, stock_quantity FROM products WHERE id IN (${placeholders}) FOR UPDATE`,
			productIds,
		);

		const productMap = new Map(lockedProducts.map(p => [p.id, p]));

		// 재고 및 가격 검증
		for (const item of data.items) {
			const product = productMap.get(item.product_id);
			if (!product) {
				await connection.rollback();
				return { error: `상품 정보를 찾을 수 없습니다. (ID: ${item.product_id})` };
			}
			// stock_quantity가 0보다 크면 재고 관리 대상, null/0이면 무제한 판매
			const stock = Number(product.stock_quantity);
			if (stock > 0 && stock < (Number(item.quantity) || 1)) {
				await connection.rollback();
				return { error: `'${product.name}' 재고가 부족합니다. (남은 수량: ${stock})` };
			}
		}

		// 트랜잭션 내 최신 가격으로 합계 재계산 (가격 조작 방어)
		let verifiedTotal = 0;
		for (const item of data.items) {
			const product = productMap.get(item.product_id);
			verifiedTotal += Number(product.price) * (Number(item.quantity) || 1);
		}

		const [orderResult] = await connection.execute(
			`INSERT INTO orders
        (order_number, user_id, guest_name, guest_email, guest_phone, status, total_amount)
        VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`,
			[orderNumber, userId, guestName || null, guestEmail || null, guestPhone || null, verifiedTotal],
		);

		const orderId = orderResult.insertId;
		const insertItemSql = `
        INSERT INTO order_items
          (order_id, product_id, product_name, product_spec, product_image, unit_price, quantity, total_price)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;

		for (const item of data.items) {
			const product = productMap.get(item.product_id);
			const quantity = Number(item.quantity) || 1;
			const unitPrice = Number(product.price) || 0; // DB 최신 가격 사용
			await connection.execute(insertItemSql, [
				orderId,
				item.product_id,
				product.name,
				item.spec || null,
				item.image || null,
				unitPrice,
				quantity,
				unitPrice * quantity,
			]);

			// 재고가 있으면 차감
			if (Number(product.stock_quantity) > 0) {
				await connection.execute(
					'UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND stock_quantity >= ?',
					[quantity, item.product_id, quantity],
				);
			}
		}

		await connection.commit();

		// items에 실제 DB 가격 반영 (카카오페이 요청 금액 동기화)
		const verifiedItems = data.items.map(item => ({
			...item,
			price: productMap.get(item.product_id)?.price || item.price,
		}));

		return { orderId, orderNumber, items: verifiedItems, totalAmount: verifiedTotal };
	} catch (err) {
		if (err?.code === 'ER_LOCK_WAIT_TIMEOUT') {
			try { await connection.rollback(); } catch (rbErr) { console.error('[createOrderFromCart] rollback failed:', rbErr); }
			return { error: '다른 주문이 처리 중입니다. 잠시 후 다시 시도해주세요.', status: 409 };
		}
		try { await connection.rollback(); } catch (rbErr) { console.error('[createOrderFromCart] rollback failed:', rbErr); }
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

// =============================================
// 스키마 초기화 — 서버 시작 시 1회만 실행
// 각 라우트 핸들러 내부에서 매 요청마다 호출하면
// ALTER TABLE이 반복 실행되어 성능 저하 발생
// =============================================
router.get('/', async (req, res) => {
	try {
		const [categories] = await db.execute('SELECT * FROM categories ORDER BY name ASC');
		const [latest] = await db.execute(`
      SELECT p.*, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.visibility_status <> 'HIDDEN'
      ORDER BY p.created_at DESC
      LIMIT 6
    `);

		res.render('shop/index', { categories, latest, totalCount: latest.length });
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

		where.push("p.visibility_status <> 'HIDDEN'");

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

		// 검색어가 있을 때만 비동기 로깅 (응답 속도에 영향 없음)
		if (q) {
			searchLogService.logSearch({
				keyword: q,
				resultCount: products.length,
				req,
				categoryFilter: categorySlug !== 'all' ? categorySlug : null,
			});
		}

		// [NO-HIT RECOVERY] 검색 결과 0건일 때 인기 검색어 제안
		let noHitSuggestions = [];
		if (q && products.length === 0) {
			try {
				noHitSuggestions = await searchLogService.getTopKeywords({ days: 7, limit: 6 });
			} catch (_) { /* non-critical: 제안 없어도 페이지는 정상 동작 */ }
		}

		res.render('shop/products', {
			products,
			categories,
			currentCategory: categorySlug,
			query: q,
			noHitSuggestions,
		});
	} catch (err) {
		console.error(err);
		return renderShopError(req, res, '상품 목록 오류', 500);
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
      WHERE p.id = ? AND p.visibility_status <> 'HIDDEN' LIMIT 1
      `,
			[productId]
		);

		if (!rows.length) return res.status(404).render('404', { message: '상품을 찾을 수 없습니다.' });

		const product = rows[0];
		const [reviews] = await db.execute(
			`SELECT r.*, u.name AS user_name
       FROM product_reviews r
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.product_id = ?
       ORDER BY r.created_at DESC`,
			[productId],
		);

		const [[reviewStats]] = await db.execute(
			`SELECT COUNT(*) AS review_count, AVG(rating) AS avg_rating
       FROM product_reviews
       WHERE product_id = ?`,
			[productId],
		);

		let wished = false;
		if (req.session.user) {
			const [[wishRow]] = await db.execute(
				`SELECT 1
         FROM user_wishlist
         WHERE user_id = ? AND product_id = ?
         LIMIT 1`,
				[req.session.user.id, productId],
			);
			wished = Boolean(wishRow);
		}

		const [related] = await db.execute(
			`SELECT id, name, price, image
       FROM products
       WHERE category_id <=> ?
         AND id <> ?
       ORDER BY created_at DESC
       LIMIT 4`,
			[product.category_id, productId],
		);

		res.render('shop/product-detail', {
			product,
			reviews,
			reviewStats,
			wished,
			related,
		});
	} catch (err) {
		console.error(err);
		return renderShopError(req, res, '상품 상세 오류', 500);
	}
});

router.post('/products/:id/reviews', requireLogin, async (req, res) => {
	try {
		const productId = Number(req.params.id);
		const rating = Number(req.body.rating);
		const content = String(req.body.content || '').trim();

		if (!productId || !rating || rating < 1 || rating > 5 || !content) {
			return res.redirect(`/shop/products/${productId}`);
		}

		await db.execute(
			`INSERT INTO product_reviews (product_id, user_id, rating, content)
       VALUES (?, ?, ?, ?)`,
			[productId, req.session.user.id, rating, content],
		);

		return res.redirect(`/shop/products/${productId}#reviews`);
	} catch (err) {
		console.error(err);
		return renderShopError(req, res, '리뷰 등록 중 오류가 발생했습니다.', 500);
	}
});

router.get('/wishlist', requireLogin, async (req, res) => {
	try {
		const [items] = await db.execute(
			`SELECT p.id, p.name, p.price, p.image
       FROM user_wishlist w
       JOIN products p ON p.id = w.product_id
       WHERE w.user_id = ?
       ORDER BY w.created_at DESC`,
			[req.session.user.id],
		);

		return res.render('shop/wishlist', {
			items,
			active: 'wishlist',
		});
	} catch (err) {
		console.error(err);
		return renderShopError(req, res, '위시리스트 로딩 중 오류가 발생했습니다.', 500);
	}
});

router.post('/wishlist/toggle', requireLogin, async (req, res) => {
	try {
		const productId = Number(req.body.productId);
		if (!productId) return res.redirect('/shop/products');

		const [[existing]] = await db.execute(
			`SELECT 1 FROM user_wishlist WHERE user_id = ? AND product_id = ? LIMIT 1`,
			[req.session.user.id, productId],
		);

		if (existing) {
			await db.execute(`DELETE FROM user_wishlist WHERE user_id = ? AND product_id = ?`, [
				req.session.user.id,
				productId,
			]);
		} else {
			await db.execute(`INSERT INTO user_wishlist (user_id, product_id) VALUES (?, ?)`, [
				req.session.user.id,
				productId,
			]);
		}

		return res.redirect(`/shop/products/${productId}`);
	} catch (err) {
		console.error(err);
		return renderShopError(req, res, '위시리스트 처리 중 오류가 발생했습니다.', 500);
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
		return renderShopError(req, res, '장바구니 오류', 500);
	}
});

// cart add
router.post('/cart/add', async (req, res) => {
	try {
		const productId = Number(req.body.productId);
		// [HIGH-1] 수량 상한 999 적용 — IEEE 754 오버플로우 및 재고 우회 공격 방지
		const quantity = Math.min(999, Math.max(1, Number(req.body.quantity) || 1));
		const isAjax = req.xhr || (req.headers.accept || '').includes('application/json') || req.headers['x-requested-with'] === 'XMLHttpRequest';

		if (!productId) {
			if (isAjax) return res.status(400).json({ ok: false, message: '상품 정보가 올바르지 않습니다.' });
			return renderShopError(req, res, '상품 정보가 올바르지 않습니다.', 400);
		}

		let cartCount = 0;

		if (req.session.user) {
			const cartId = await ensureUserCartId(req.session.user.id);
			const [exist] = await db.execute('SELECT id FROM cart_items WHERE cart_id = ? AND product_id = ? LIMIT 1', [cartId, productId]);
			if (exist.length) {
				// [HIGH-1b] 누적 합계도 999 상한 — LEAST() 로 DB 레벨에서 원자적으로 적용
				await db.execute('UPDATE cart_items SET quantity = LEAST(quantity + ?, 999) WHERE id = ?', [quantity, exist[0].id]);
			} else {
				await db.execute('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)', [cartId, productId, quantity]);
			}
			const [[cnt]] = await db.execute('SELECT COALESCE(SUM(quantity),0) AS cnt FROM cart_items WHERE cart_id = ?', [cartId]);
			cartCount = Number(cnt?.cnt || 0);
		} else {
			const guestCart = getGuestCart(req);
			// [HIGH-1b] 게스트 카트 누적 합계도 999 상한 적용
			guestCart.items[productId] = Math.min(999, (Number(guestCart.items[productId]) || 0) + quantity);
			cartCount = Object.values(guestCart.items).reduce((s, v) => s + (Number(v) || 0), 0);
		}

		if (isAjax) return res.json({ ok: true, cartCount });
		return res.redirect('/shop/cart');
	} catch (err) {
		console.error(err);
		const isAjax = req.xhr || (req.headers.accept || '').includes('application/json');
		if (isAjax) return res.status(500).json({ ok: false, message: '장바구니 담기 오류' });
		return renderShopError(req, res, '장바구니 담기 오류', 500);
	}
});

// cart update
router.post('/cart/update', async (req, res) => {
	try {
		const productId = Number(req.body.productId);
		// [HIGH-1b] cart/update 도 1~999 범위 강제
		const quantity = Math.min(999, Math.max(1, Number(req.body.quantity) || 1));

		if (req.session.user) {
			const cartItemId = Number(req.body.cartItemId);
			// [C-1 IDOR 수정] AND cart_id = ? 추가: 반드시 현재 사용자의 장바구니 아이템만 수정
			// 소유권 검사 없이 cartItemId만으로 UPDATE하면 타인의 장바구니 항목 수정 가능
			const cartId = await ensureUserCartId(req.session.user.id);
			await db.execute(
				'UPDATE cart_items SET quantity = ? WHERE id = ? AND cart_id = ?',
				[quantity, cartItemId, cartId],
			);
			return res.redirect('/shop/cart');
		}

		const guestCart = getGuestCart(req);
		if (guestCart.items[productId]) guestCart.items[productId] = quantity;
		return res.redirect('/shop/cart');
	} catch (err) {
		console.error(err);
		return renderShopError(req, res, '장바구니 수정 오류', 500);
	}
});

// cart remove
router.post('/cart/remove', async (req, res) => {
	try {
		const productId = Number(req.body.productId);

		if (req.session.user) {
			const cartItemId = Number(req.body.cartItemId);
			// [C-1 IDOR 수정] AND cart_id = ? 추가: 현재 사용자의 장바구니 아이템만 삭제 가능
			const cartId = await ensureUserCartId(req.session.user.id);
			await db.execute(
				'DELETE FROM cart_items WHERE id = ? AND cart_id = ?',
				[cartItemId, cartId],
			);
			return res.redirect('/shop/cart');
		}

		const guestCart = getGuestCart(req);
		delete guestCart.items[productId];
		return res.redirect('/shop/cart');
	} catch (err) {
		console.error(err);
		return renderShopError(req, res, '장바구니 삭제 오류', 500);
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
		return renderShopError(req, res, '장바구니 비우기 오류', 500);
	}
});

router.post('/checkout/kakao', kakaoCheckoutLimiter, async (req, res) => {
	try {
		if (!kakaoPayService.isConfigured()) {
			return renderShopError(req, res, '카카오페이 설정이 필요합니다. 환경변수 KAKAO_ADMIN_KEY와 KAKAO_CID를 확인해주세요.', 500);
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

		// [H-1] 중복 주문 방지: 이미 진행 중인 PENDING 주문이 있으면 재사용
		// 뒤로가기 후 재결제 시 동일 카트에서 두 번째 주문이 생성되는 것을 차단
		if (req.session.kakaoPay?.orderId) {
			const [[existingOrder]] = await db.execute(
				`SELECT id, order_number, total_amount FROM orders WHERE id = ? AND status = 'PENDING' LIMIT 1`,
				[req.session.kakaoPay.orderId],
			);
			if (existingOrder) {
				// 기존 PENDING 주문을 취소하고 새로 생성 (카트 변경 가능성 있음)
				await db.execute(`UPDATE orders SET status = 'CANCELED' WHERE id = ?`, [existingOrder.id]);
				await db.execute(
					`UPDATE order_payments SET status = 'CANCELED' WHERE order_id = ?`,
					[existingOrder.id],
				);
			}
			req.session.kakaoPay = null;
		}

		const orderResult = await createOrderFromCart(req, { guestName, guestEmail, guestPhone });
		if (orderResult.status === 409) {
			return renderShopError(req, res, orderResult.error, 409, '/shop/cart');
		}
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
		return renderShopError(req, res, '카카오페이 결제 준비 중 오류가 발생했습니다.', 500);
	}
});

router.get('/checkout/kakao/approve', async (req, res) => {
	try {
		const pgToken = req.query.pg_token;
		const sessionPayment = req.session.kakaoPay;

		if (!pgToken || !sessionPayment) {
			return renderShopError(req, res, '결제 승인 정보가 없습니다.', 400);
		}

		// [HIGH-4] 멱등성 가드: 이미 PAID/FAILED 상태인 주문의 중복 승인 방지
		// 브라우저 더블클릭, 탭 중복, 네트워크 재시도 등으로 pg_token이 두 번 처리되는 상황 차단
		const [[orderCheck]] = await db.execute(
			'SELECT status FROM orders WHERE id = ? LIMIT 1',
			[sessionPayment.orderId]
		);
		if (!orderCheck || orderCheck.status !== 'PENDING') {
			console.warn(`[kakao-approve] 중복 승인 시도 — orderId=${sessionPayment.orderId}, status=${orderCheck?.status}`);
			req.session.kakaoPay = null;
			return res.redirect('/shop/account/orders');
		}

		const approvalResult = await kakaoPayService.approve({
			tid: sessionPayment.tid,
			orderId: sessionPayment.orderNumber,
			userId: req.session.user?.id,
			pgToken,
		});

		// [C-1] 결제 금액 검증: PG 승인 금액과 주문 금액 불일치 시 위변조로 간주
		const approvedAmount = Number(approvalResult?.amount?.total || 0);
		const expectedAmount = Number(sessionPayment.totalAmount || 0);
		if (approvedAmount !== expectedAmount || approvedAmount === 0) {
			console.error(`[payment] 금액 불일치: approved=${approvedAmount}, expected=${expectedAmount}, orderId=${sessionPayment.orderId}`);
			await db.execute(`UPDATE orders SET status = 'FAILED' WHERE id = ?`, [sessionPayment.orderId]);
			await db.execute(
				`UPDATE order_payments SET status = 'AMOUNT_MISMATCH' WHERE order_id = ? AND tid = ?`,
				[sessionPayment.orderId, sessionPayment.tid],
			);
			req.session.kakaoPay = null;
			return res.status(400).render('shop/payment-fail', {
				message: '결제 금액이 일치하지 않습니다. 관리자에게 문의해주세요.',
			});
		}

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

// ══════════════════════════════════════════
// 계좌 입금 결제
// ══════════════════════════════════════════
router.post('/checkout/bank', async (req, res) => {
	try {
		const isGuest = !req.session.user;
		const guestName = isGuest ? String(req.body.guestName || '').trim() : null;
		const guestEmail = isGuest ? String(req.body.guestEmail || '').trim() : null;
		const guestPhone = isGuest ? String(req.body.guestPhone || '').trim() : null;

		if (isGuest && (!guestName || (!guestEmail && !guestPhone))) {
			req.session.cartError = '비회원 주문은 이름과 이메일 또는 연락처가 필요합니다.';
			return res.redirect('/shop/cart');
		}

		const orderResult = await createOrderFromCart(req, { guestName, guestEmail, guestPhone });
		if (orderResult.status === 409) {
			return renderShopError(req, res, orderResult.error, 409, '/shop/cart');
		}
		if (orderResult.error) {
			req.session.cartError = orderResult.error;
			return res.redirect('/shop/cart');
		}

		await db.execute(
			`INSERT INTO order_payments (order_id, provider, status, amount) VALUES (?, 'BANK_TRANSFER', 'PENDING', ?)`,
			[orderResult.orderId, orderResult.totalAmount],
		);

		await clearCart(req);

		req.session.bankOrder = {
			orderId: orderResult.orderId,
			orderNumber: orderResult.orderNumber,
			totalAmount: orderResult.totalAmount,
		};

		return res.redirect(`/shop/checkout/bank/complete?order=${encodeURIComponent(orderResult.orderNumber)}`);
	} catch (err) {
		console.error('[checkout/bank]', err);
		return renderShopError(req, res, '계좌 입금 주문 처리 중 오류가 발생했습니다.', 500);
	}
});

router.get('/checkout/bank/complete', async (req, res) => {
	try {
		const orderNumber = String(req.query.order || '').trim();
		if (!orderNumber) {
			return renderShopError(req, res, '주문 정보가 없습니다.', 400, '/shop/cart');
		}

		const [[order]] = await db.execute(
			`SELECT o.id, o.order_number, o.total_amount, o.status, o.created_at,
			        op.status AS payment_status
			 FROM orders o
			 LEFT JOIN order_payments op ON op.order_id = o.id AND op.provider = 'BANK_TRANSFER'
			 WHERE o.order_number = ?
			 LIMIT 1`,
			[orderNumber],
		);

		if (!order) {
			return renderShopError(req, res, '주문을 찾을 수 없습니다.', 404, '/shop/cart');
		}

		const bankName = process.env.BANK_NAME || '국민은행';
		const bankAccount = process.env.BANK_ACCOUNT || '000-0000-0000';
		const bankHolder = process.env.BANK_HOLDER || 'ENERMADE';

		req.session.bankOrder = null;

		return res.render('shop/bank-complete', {
			order,
			bankName,
			bankAccount,
			bankHolder,
			active: '',
			title: '계좌 입금 안내',
		});
	} catch (err) {
		console.error('[checkout/bank/complete]', err);
		return renderShopError(req, res, '주문 완료 페이지 로딩 중 오류가 발생했습니다.', 500);
	}
});

// ══════════════════════════════════════════
// 세금계산서 발행 요청
// POST /shop/orders/:orderNumber/tax-invoice
// ══════════════════════════════════════════
router.post('/orders/:orderNumber/tax-invoice', async (req, res) => {
	try {
		const orderNumber = String(req.params.orderNumber || '').trim();
		const businessName = String(req.body.business_name || '').trim();
		const businessRegNo = String(req.body.business_reg_no || '').trim().replace(/\D/g, '');
		const repName = String(req.body.rep_name || '').trim();
		const contactEmail = String(req.body.contact_email || '').trim();

		if (!businessName) {
			return res.status(400).json({ ok: false, message: '사업자명을 입력해주세요.' });
		}
		if (businessRegNo.length !== 10) {
			return res.status(400).json({ ok: false, message: '사업자등록번호는 10자리 숫자로 입력해주세요.' });
		}
		if (!repName) {
			return res.status(400).json({ ok: false, message: '대표자명을 입력해주세요.' });
		}
		if (!contactEmail || !isValidEmail(contactEmail)) {
			return res.status(400).json({ ok: false, message: '올바른 이메일 주소를 입력해주세요.' });
		}

		const [[order]] = await db.execute(
			`SELECT id, order_number FROM orders WHERE order_number = ? LIMIT 1`,
			[orderNumber],
		);

		if (!order) {
			return res.status(404).json({ ok: false, message: '주문을 찾을 수 없습니다.' });
		}

		await db.execute(
			`INSERT INTO tax_invoice_requests
			 (order_id, order_number, business_name, business_reg_no, rep_name, contact_email)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			[order.id, order.order_number, businessName, businessRegNo, repName, contactEmail],
		);

		return res.json({ ok: true, message: '세금계산서 발행 요청이 접수되었습니다.' });
	} catch (err) {
		console.error('[tax-invoice]', err);
		return res.status(500).json({ ok: false, message: '세금계산서 요청 처리 중 오류가 발생했습니다.' });
	}
});

router.get('/checkout/kakao/cancel', (req, res) => {
	const sessionPayment = req.session.kakaoPay;
	if (sessionPayment?.orderId) {
		// [M-8] 소유권 검증: 세션에서 가져온 orderId만 사용 (쿼리 파라미터 무시)
		// 세션은 서버 측에서만 설정되므로 타 사용자의 주문 취소 불가
		db.execute(
			`UPDATE orders SET status = 'CANCELED' WHERE id = ? AND (user_id = ? OR user_id IS NULL)`,
			[sessionPayment.orderId, req.session.user?.id || null],
		).catch((err) => console.error('[kakao/cancel]', err));
		db.execute(
			`UPDATE order_payments SET status = 'CANCELED' WHERE order_id = ? AND tid = ?`,
			[sessionPayment.orderId, sessionPayment.tid],
		).catch((err) => console.error('[kakao/cancel payments]', err));
	}
	req.session.kakaoPay = null;
	return res.render('shop/payment-fail', {
		message: '카카오페이 결제가 취소되었습니다.',
	});
});

router.get('/checkout/kakao/fail', (req, res) => {
	const sessionPayment = req.session.kakaoPay;
	if (sessionPayment?.orderId) {
		// [M-8] 소유권 검증: 세션 기반 orderId만 사용
		db.execute(
			`UPDATE orders SET status = 'FAILED' WHERE id = ? AND (user_id = ? OR user_id IS NULL)`,
			[sessionPayment.orderId, req.session.user?.id || null],
		).catch((err) => console.error('[kakao/fail]', err));
		db.execute(
			`UPDATE order_payments SET status = 'FAILED' WHERE order_id = ? AND tid = ?`,
			[sessionPayment.orderId, sessionPayment.tid],
		).catch((err) => console.error('[kakao/fail payments]', err));
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

router.post('/orders/guest', guestOrderLookupLimiter, async (req, res) => {
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

		// [H-2] 비회원 주문조회 인증: 빈 문자열/null edge case 방지
		// 이메일 또는 연락처 중 하나가 입력되었고 DB 값과 정확히 일치해야 통과
		const emailMatch = guestEmail && detail.order.guest_email && detail.order.guest_email === guestEmail;
		const phoneMatch = guestPhone && detail.order.guest_phone && detail.order.guest_phone === guestPhone;
		if (!emailMatch && !phoneMatch) {
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
		return renderShopError(req, res, '주문 조회 중 오류가 발생했습니다.', 500);
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
		return renderShopError(req, res, '주문 상세 조회 오류', 500);
	}
});

router.get('/account', requireLogin, accountCsrf, async (req, res) => {
	try {
		const userId = req.session.user.id;
		const [[user]] = await db.execute('SELECT id, name, email, is_admin FROM users WHERE id = ? LIMIT 1', [userId]);
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
		return renderShopError(req, res, '내 정보 로딩 중 오류가 발생했습니다.', 500);
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
			// [M-6] bcrypt는 72바이트 초과 입력을 조용히 잘라냄 — 미리 검사해야 함
			// 72자 초과 비밀번호는 truncation 후 충돌 가능 + 매우 긴 입력은 이벤트 루프 차단
			if (password.length > 72) {
				return res.redirect('/shop/account?error=비밀번호는 72자 이하로 입력해주세요.');
			}
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
		return renderShopError(req, res, '내 정보 수정 중 오류가 발생했습니다.', 500);
	}
});

router.post('/account/notifications', requireLogin, accountCsrf, async (req, res) => {
	try {
		const userId = req.session.user.id;
		const emailEnabled = req.body.emailNotifications === 'on' ? 1 : 0;

		await db.execute(
			`INSERT INTO user_notification_settings (user_id, email_enabled)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE email_enabled = VALUES(email_enabled)`,
			[userId, emailEnabled],
		);

		return res.redirect('/shop/account?message=알림 설정이 저장되었습니다.');
	} catch (err) {
		console.error(err);
		return renderShopError(req, res, '알림 설정 저장 중 오류가 발생했습니다.', 500);
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

		await db.execute(
			`INSERT INTO user_addresses
       (user_id, label, recipient_name, phone, address_line1, address_line2, postal_code)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[userId, label || null, recipientName, phone || null, addressLine1, addressLine2 || null, postalCode || null],
		);

		return res.redirect('/shop/account?message=배송지가 추가되었습니다.');
	} catch (err) {
		console.error(err);
		return renderShopError(req, res, '배송지 저장 중 오류가 발생했습니다.', 500);
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
		return renderShopError(req, res, '배송지 삭제 중 오류가 발생했습니다.', 500);
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

		await db.execute(
			`INSERT INTO user_payment_methods (user_id, label, provider, last4)
       VALUES (?, ?, ?, ?)`,
			[userId, label || null, provider, last4],
		);

		return res.redirect('/shop/account?message=결제수단이 저장되었습니다.');
	} catch (err) {
		console.error(err);
		return renderShopError(req, res, '결제수단 저장 중 오류가 발생했습니다.', 500);
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
		return renderShopError(req, res, '결제수단 삭제 중 오류가 발생했습니다.', 500);
	}
});

router.post('/account/coupons', requireLogin, accountCsrf, async (req, res) => {
	try {
		const userId = req.session.user.id;
		const code = String(req.body.code || '').trim();
		const description = String(req.body.description || '').trim();
		const discountPct = Number(req.body.discountPct || 0);
		const expiresAt = String(req.body.expiresAt || '').trim();

		if (!code) {
			return res.redirect('/shop/account?error=쿠폰 코드를 입력해주세요.');
		}

		await db.execute(
			`INSERT INTO user_coupons (user_id, code, description, discount_pct, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
			[userId, code, description || null, discountPct || 0, expiresAt || null],
		);

		return res.redirect('/shop/account?message=쿠폰이 등록되었습니다.');
	} catch (err) {
		console.error(err);
		return renderShopError(req, res, '쿠폰 등록 중 오류가 발생했습니다.', 500);
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
		return renderShopError(req, res, '문의 내역 로딩 중 오류가 발생했습니다.', 500);
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
		return renderShopError(req, res, '주문 내역 로딩 중 오류가 발생했습니다.', 500);
	}
});

router.post('/account/orders/:orderId/cancel', requireLogin, accountCsrf, async (req, res) => {
	try {
		const orderId = Number(req.params.orderId);
		const userId = req.session.user.id;

		if (!orderId) {
			return renderShopError(req, res, '주문 정보가 올바르지 않습니다.', 400);
		}

		const [[order]] = await db.execute(
			`SELECT id, status
       FROM orders
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
			[orderId, userId],
		);

		if (!order) {
			return renderShopError(req, res, '주문 정보를 찾을 수 없습니다.', 404);
		}

		if (order.status !== 'PENDING') {
			return res.redirect('/shop/account/orders');
		}

		await db.execute('UPDATE orders SET status = ? WHERE id = ?', ['CANCEL_REQUESTED', orderId]);
		return res.redirect('/shop/account/orders');
	} catch (err) {
		console.error(err);
		return renderShopError(req, res, '주문 취소 요청 중 오류가 발생했습니다.', 500);
	}
});

router.post('/account/delete', requireLogin, accountCsrf, async (req, res) => {
	const userId = req.session.user.id;

	// [M-4] try/catch로 전체 감싸기: 스키마 초기화 및 DB 조회 실패 시 unhandled rejection 방지
	let user;
	try {
		// [E-1] 사용자 존재 확인을 getConnection() 전에 실행: 불필요한 connection 점유 방지
		const [[foundUser]] = await db.execute('SELECT name, email FROM users WHERE id = ? LIMIT 1', [userId]);
		user = foundUser;
	} catch (err) {
		console.error('[account/delete] 사전 조회 실패:', err);
		return renderShopError(req, res, '회원 탈퇴 처리 중 오류가 발생했습니다.', 500);
	}

	if (!user) {
		return renderShopError(req, res, '사용자 정보를 찾을 수 없습니다.', 404);
	}

	const connection = await db.getConnection();
	try {
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
		// [E-1] rollback 실패 자체도 로깅: 원래 에러가 숨겨지지 않도록 별도 try-catch
		try {
			await connection.rollback();
		} catch (rbErr) {
			console.error('[account/delete] rollback 실패:', rbErr);
		}
		console.error('[account/delete]', err);
		return renderShopError(req, res, '회원 탈퇴 처리 중 오류가 발생했습니다.', 500);
	} finally {
		connection.release();
	}
});

// ══════════════════════════════════════════
// 대량 SKU 업로드 발주 — 장바구니에서 호출
// POST /shop/cart/bulk  body: { skuList: "SKU001,10\nSKU002,5" }
// ══════════════════════════════════════════
router.post('/cart/bulk', async (req, res) => {
	try {
		const rawList = String(req.body.skuList || '').trim();
		if (!rawList) {
			return res.status(400).json({ ok: false, message: 'SKU 목록을 입력해주세요.' });
		}

		const lines = rawList.split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 100);
		const results = [];

		for (const line of lines) {
			// 구분자: 쉼표, 탭, 공백 1~n개
			const parts = line.split(/[,\t]+|\s{2,}/);
			const code = String(parts[0] || '').trim();
			const quantity = Math.max(1, Math.min(999, parseInt(parts[1]) || 1));

			if (!code) continue;

			const [[product]] = await db.execute(
				`SELECT id, name, price, stock_quantity
				 FROM products WHERE code = ? AND visibility_status != 'HIDDEN' LIMIT 1`,
				[code],
			);

			if (!product) {
				results.push({ code, quantity, status: 'not_found', message: '상품을 찾을 수 없습니다.' });
				continue;
			}

			// 장바구니에 추가
			if (req.session?.user) {
				const cartId = await ensureUserCartId(req.session.user.id);
				const [[existing]] = await db.execute(
					'SELECT id, quantity FROM cart_items WHERE cart_id = ? AND product_id = ?',
					[cartId, product.id],
				);
				if (existing) {
					await db.execute(
						'UPDATE cart_items SET quantity = LEAST(quantity + ?, 999) WHERE id = ?',
						[quantity, existing.id],
					);
				} else {
					await db.execute(
						'INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)',
						[cartId, product.id, quantity],
					);
				}
			} else {
				const guestCart = getGuestCart(req);
				const prev = Number(guestCart.items[product.id] || 0);
				guestCart.items[product.id] = Math.min(999, prev + quantity);
				req.session.cart = guestCart;
			}

			results.push({ code, name: product.name, quantity, price: product.price, status: 'added' });
		}

		const addedCount = results.filter(r => r.status === 'added').length;
		return res.json({ ok: true, results, addedCount, message: `${addedCount}개 상품이 장바구니에 담겼습니다.` });
	} catch (err) {
		console.error('[cart/bulk]', err);
		return res.status(500).json({ ok: false, message: '대량 담기 처리 중 오류가 발생했습니다.' });
	}
});

// ══════════════════════════════════════════
// 샘플 요청·평가 플로우 — 상품상세에서 호출
// POST /shop/inquiries/sample
// ══════════════════════════════════════════
router.post('/inquiries/sample', async (req, res) => {
	try {
		const productId    = Number(req.body.productId    || 0) || null;
		const quantity     = Math.max(1, Math.min(5, Number(req.body.quantity || 1)));
		const application  = String(req.body.application  || '').trim().slice(0, 200);
		const testCondition= String(req.body.testCondition|| '').trim().slice(0, 200);
		const contactName  = String(req.body.contactName  || '').trim().slice(0, 100);
		const contactEmail = String(req.body.contactEmail || '').trim().slice(0, 150);
		const companyName  = String(req.body.companyName  || '').trim().slice(0, 100);

		if (!contactName || !contactEmail) {
			return res.status(400).json({ ok: false, message: '담당자명과 이메일은 필수입니다.' });
		}
		if (!application) {
			return res.status(400).json({ ok: false, message: '적용 장비/용도는 필수입니다.' });
		}
		if (!isValidEmail(contactEmail)) {
			return res.status(400).json({ ok: false, message: '올바른 이메일 주소를 입력해주세요.' });
		}

		let productName = '';
		if (productId) {
			const [[p]] = await db.execute('SELECT name, code FROM products WHERE id = ? LIMIT 1', [productId]);
			productName = p ? `${p.name}${p.code ? ` (${p.code})` : ''}` : '';
		}

		const title = `[샘플요청] ${productName || '상품'} × ${quantity}개`;
		const content = [
			`회사명: ${companyName || '(미입력)'}`,
			`담당자: ${contactName}`,
			`이메일: ${contactEmail}`,
			`샘플 수량: ${quantity}개`,
			`적용 장비/용도: ${application || '(미입력)'}`,
			`시험 조건: ${testCondition || '(미입력)'}`,
			productId ? `\n[상품ID: ${productId}]` : '',
		].join('\n');

		const userId     = req.session?.user?.id || null;
		const guestName  = userId ? null : contactName;
		const guestEmail = userId ? null : contactEmail;

		await db.execute(
			`INSERT INTO inquiries (user_id, guest_name, guest_email, title, content, status, created_at)
			 VALUES (?, ?, ?, ?, ?, 'NEW', NOW())`,
			[userId, guestName, guestEmail, title, content],
		);

		return res.json({ ok: true, message: '샘플 요청이 접수되었습니다. 2~3 영업일 내 배송 안내 드립니다.' });
	} catch (err) {
		console.error('[sample]', err);
		return res.status(500).json({ ok: false, message: '샘플 요청 처리 중 오류가 발생했습니다.' });
	}
});

// ══════════════════════════════════════════
// RFQ (견적 요청 빌더) — 상품상세·장바구니에서 호출
// ══════════════════════════════════════════
router.post('/inquiries/rfq', async (req, res) => {
	try {
		const productId   = Number(req.body.productId  || 0) || null;
		const quantity    = Math.max(1, Math.min(9999, Number(req.body.quantity    || 1)));
		const targetPrice = String(req.body.targetPrice || '').trim().slice(0, 100);
		const deliveryDate= String(req.body.deliveryDate|| '').trim().slice(0, 50);
		const companyName = String(req.body.companyName || '').trim().slice(0, 100);
		const contactName = String(req.body.contactName || '').trim().slice(0, 100);
		const contactEmail= String(req.body.contactEmail|| '').trim().slice(0, 150);
		const message     = String(req.body.message     || '').trim().slice(0, 1000);

		if (!contactName || !contactEmail) {
			return res.status(400).json({ ok: false, message: '담당자명과 이메일은 필수입니다.' });
		}
		// 간단한 이메일 형식 검증
		if (!isValidEmail(contactEmail)) {
			return res.status(400).json({ ok: false, message: '올바른 이메일 주소를 입력해주세요.' });
		}

		// 상품 이름 조회
		let productName = '';
		if (productId) {
			const [[p]] = await db.execute('SELECT name, code FROM products WHERE id = ? LIMIT 1', [productId]);
			productName = p ? `${p.name}${p.code ? ` (${p.code})` : ''}` : '';
		}

		const title = `[견적요청] ${productName || '일반 견적'} × ${quantity}개`;
		const contentLines = [
			`회사명: ${companyName || '(미입력)'}`,
			`담당자: ${contactName}`,
			`이메일: ${contactEmail}`,
			`수량: ${quantity}개`,
			`목표 단가: ${targetPrice || '협의'}`,
			`희망 납기: ${deliveryDate || '협의'}`,
		];
		if (message) {
			contentLines.push('', '요청사항:', message);
		}
		if (productId) {
			contentLines.push('', `[상품ID: ${productId}]`);
		}
		const content = contentLines.join('\n');

		const userId    = req.session?.user?.id  || null;
		const guestName = userId ? null : contactName;
		const guestEmail= userId ? null : contactEmail;

		await db.execute(
			`INSERT INTO inquiries (user_id, guest_name, guest_email, title, content, status, created_at)
			 VALUES (?, ?, ?, ?, ?, 'NEW', NOW())`,
			[userId, guestName, guestEmail, title, content],
		);

		return res.json({ ok: true, message: '견적 요청이 접수되었습니다. 빠른 시일 내에 연락드리겠습니다.' });
	} catch (err) {
		console.error('[rfq]', err);
		return res.status(500).json({ ok: false, message: '견적 요청 처리 중 오류가 발생했습니다.' });
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
		return renderShopError(req, res, '문의 조회 중 오류가 발생했습니다.', 500);
	}
});

router.post('/inquiries', shopInquiryLimiter, async (req, res) => {
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
		return renderShopError(req, res, '문의 등록 중 오류가 발생했습니다.', 500);
	}
});

module.exports = router;
