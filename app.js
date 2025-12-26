// app.js
require('dotenv').config(); // 🔥 항상 최상단

const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const multer = require('multer');
const xlsx = require('xlsx');

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// 업로드(엑셀)
const upload = multer({ dest: 'uploads/' });

// 기본 미들웨어
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 세션
app.use(
	session({
		secret: process.env.SESSION_SECRET || 'change_me_in_env',
		resave: false,
		saveUninitialized: false,
		cookie: { maxAge: 1000 * 60 * 60 }, // 1h
	})
);

// 전역 locals
app.use((req, res, next) => {
	res.locals.currentPath = req.path;
	res.locals.user = req.session.user || null;
	next();
});
app.use(async (req, res, next) => {
	try {
		// 기본값
		res.locals.cartCount = 0;

		// 로그인
		if (req.session.user) {
			const userId = req.session.user.id;
			const cartId = await ensureUserCartId(userId);

			const [rows] = await db.execute('SELECT COALESCE(SUM(quantity),0) AS cnt FROM cart_items WHERE cart_id = ?', [cartId]);
			res.locals.cartCount = Number(rows[0]?.cnt || 0);
			return next();
		}

		// 비로그인(세션)
		const items = req.session.guestCart?.items || {};
		res.locals.cartCount = Object.values(items).reduce((s, v) => s + (Number(v) || 0), 0);

		return next();
	} catch (err) {
		console.error(err);
		return next(); // 배지 계산 실패해도 페이지는 뜨게
	}
});

// view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

/* -----------------------------
   유틸/미들웨어
------------------------------*/
function requireLogin(req, res, next) {
	if (!req.session.user) return res.redirect('/auth/login');
	next();
}

// 게스트 장바구니(세션) 구조:
// req.session.guestCart = { items: { [productId]: quantity } }
function getGuestCart(req) {
	if (!req.session.guestCart) req.session.guestCart = { items: {} };
	return req.session.guestCart;
}

async function ensureUserCartId(userId) {
	const [rows] = await db.execute('SELECT id FROM carts WHERE user_id = ? LIMIT 1', [userId]);
	if (rows.length) return rows[0].id;

	const [result] = await db.execute('INSERT INTO carts (user_id) VALUES (?)', [userId]);
	return result.insertId;
}

async function getCartViewData(req) {
	// 로그인 상태면 DB 장바구니, 아니면 세션 장바구니
	if (req.session.user) {
		const userId = req.session.user.id;
		const cartId = await ensureUserCartId(userId);

		const [items] = await db.execute(
			`
      SELECT
        ci.id AS cart_item_id,
        ci.cart_id,
        ci.product_id,
        ci.quantity,
        p.name,
        p.price,
        p.image
      FROM cart_items ci
      JOIN products p ON p.id = ci.product_id
      WHERE ci.cart_id = ?
      ORDER BY ci.id DESC
      `,
			[cartId]
		);

		const totalAmount = items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0);

		return { isGuest: false, items, totalAmount };
	}

	// guest
	const guestCart = getGuestCart(req);
	const productIds = Object.keys(guestCart.items)
		.map((x) => Number(x))
		.filter(Boolean);

	if (productIds.length === 0) return { isGuest: true, items: [], totalAmount: 0 };

	const placeholders = productIds.map(() => '?').join(',');
	const [products] = await db.execute(`SELECT id, name, price, image FROM products WHERE id IN (${placeholders})`, productIds);

	// products -> items
	const items = products.map((p) => ({
		cart_item_id: null,
		product_id: p.id,
		quantity: Number(guestCart.items[p.id]) || 1,
		name: p.name,
		price: p.price,
		image: p.image,
	}));

	const totalAmount = items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0);

	return { isGuest: true, items, totalAmount };
}

/* -----------------------------
   회사(현행 유지) 라우트
------------------------------*/
app.get('/', (req, res) => res.render('company/index')); // 회사 홈
app.get('/about', (req, res) => res.render('company/about')); // 회사 소개(현행 유지)
app.get('/contact', (req, res) => res.render('company/contact'));

/* -----------------------------
   Auth 라우트
------------------------------*/
app.get('/auth/login', (req, res) => res.render('auth/login'));
app.get('/auth/register', (req, res) => res.render('auth/register'));

app.post('/auth/register', async (req, res) => {
	try {
		const { name, email, password, passwordConfirm } = req.body;
		if (password !== passwordConfirm) return res.send('비밀번호가 일치하지 않습니다.');

		const hashedPw = await bcrypt.hash(password, 10);
		await db.execute('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', [name, email, hashedPw]);

		return res.redirect('/auth/login');
	} catch (err) {
		console.error(err);
		return res.status(500).send('회원가입 중 오류 발생');
	}
});

app.post('/auth/login', async (req, res) => {
	try {
		const { email, password } = req.body;

		const [rows] = await db.execute('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
		if (rows.length === 0) return res.send('존재하지 않는 이메일입니다.');

		const user = rows[0];
		const ok = await bcrypt.compare(password, user.password);
		if (!ok) return res.send('비밀번호가 일치하지 않습니다.');

		req.session.user = { id: user.id, name: user.name, email: user.email };
		await mergeGuestCartToUserCart(req);

		// ✅ 로그인하면 “게스트 장바구니”를 DB 장바구니로 병합(선택 기능)
		// 병합 로직은 안전하게 "있으면 +=" 방식
		try {
			const guestCart = req.session.guestCart?.items || {};
			const guestProductIds = Object.keys(guestCart);

			if (guestProductIds.length > 0) {
				const cartId = await ensureUserCartId(user.id);

				for (const pidStr of guestProductIds) {
					const pid = Number(pidStr);
					const qty = Number(guestCart[pidStr]) || 1;

					// 이미 있으면 quantity 증가, 없으면 insert
					const [exist] = await db.execute('SELECT id, quantity FROM cart_items WHERE cart_id = ? AND product_id = ? LIMIT 1', [cartId, pid]);

					if (exist.length > 0) {
						await db.execute('UPDATE cart_items SET quantity = quantity + ? WHERE id = ?', [qty, exist[0].id]);
					} else {
						await db.execute('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)', [cartId, pid, qty]);
					}
				}

				// 병합 후 게스트 장바구니 비우기
				req.session.guestCart = { items: {} };
			}
		} catch (mergeErr) {
			// 병합 실패해도 로그인은 성공해야 함
			console.error('guest cart merge error:', mergeErr);
		}

		return res.redirect('/shop'); // 로그인 후 상품몰로
	} catch (err) {
		console.error(err);
		return res.status(500).send('로그인 중 오류');
	}
});

app.get('/auth/logout', (req, res) => {
	req.session.destroy((err) => {
		if (err) console.error(err);
		res.clearCookie('connect.sid');
		return res.redirect('/');
	});
});

/* -----------------------------
   Shop (쇼핑몰 전용)
------------------------------*/
app.get('/shop', async (req, res) => {
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

// 상품 리스트 (카테고리/검색)
app.get('/shop/products', async (req, res) => {
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

		if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`;
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
		res.status(500).send('상품 목록을 불러오는 중 오류가 발생했습니다.');
	}
});

// 상품 상세
app.get('/shop/products/:id', async (req, res) => {
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

		if (rows.length === 0) return res.status(404).render('404', { message: '상품을 찾을 수 없습니다.' });

		res.render('shop/product-detail', { product: rows[0] });
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 정보를 불러오는 중 오류가 발생했습니다.');
	}
});

/* -----------------------------
   장바구니 (회원/비회원 모두)
------------------------------*/
app.get('/shop/cart', async (req, res) => {
	try {
		const data = await getCartViewData(req);
		res.render('shop/cart', data);
	} catch (err) {
		console.error(err);
		res.status(500).send('장바구니를 불러오는 중 오류가 발생했습니다.');
	}
});

// 장바구니 담기
app.post('/shop/cart/add', async (req, res) => {
	try {
		const productId = Number(req.body.productId);
		const quantity = Math.max(1, Number(req.body.quantity) || 1);

		if (!productId) return res.status(400).send('상품 정보가 올바르지 않습니다.');

		// 로그인: DB
		if (req.session.user) {
			const userId = req.session.user.id;
			const cartId = await ensureUserCartId(userId);

			const [exist] = await db.execute('SELECT id, quantity FROM cart_items WHERE cart_id = ? AND product_id = ? LIMIT 1', [cartId, productId]);

			if (exist.length > 0) {
				await db.execute('UPDATE cart_items SET quantity = quantity + ? WHERE id = ?', [quantity, exist[0].id]);
			} else {
				await db.execute('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)', [cartId, productId, quantity]);
			}

			return res.redirect('/shop/cart');
		}

		// 비로그인: 세션
		const guestCart = getGuestCart(req);
		guestCart.items[productId] = (Number(guestCart.items[productId]) || 0) + quantity;

		return res.redirect('/shop/cart');
	} catch (err) {
		console.error(err);
		res.status(500).send('장바구니 담기 중 오류');
	}
});

// 수량 수정
app.post('/shop/cart/update', async (req, res) => {
	try {
		const productId = Number(req.body.productId);
		const quantity = Math.max(1, Number(req.body.quantity) || 1);

		if (!productId) return res.status(400).send('상품 정보가 올바르지 않습니다.');

		// 로그인: DB
		if (req.session.user) {
			const cartItemId = Number(req.body.cartItemId);
			if (!cartItemId) return res.status(400).send('cartItemId가 없습니다.');

			await db.execute('UPDATE cart_items SET quantity = ? WHERE id = ?', [quantity, cartItemId]);
			return res.redirect('/shop/cart');
		}

		// 비로그인: 세션
		const guestCart = getGuestCart(req);
		if (!guestCart.items[productId]) return res.redirect('/shop/cart');

		guestCart.items[productId] = quantity;
		return res.redirect('/shop/cart');
	} catch (err) {
		console.error(err);
		res.status(500).send('장바구니 수정 중 오류');
	}
});

// 삭제
app.post('/shop/cart/remove', async (req, res) => {
	try {
		const productId = Number(req.body.productId);

		// 로그인: DB
		if (req.session.user) {
			const cartItemId = Number(req.body.cartItemId);
			if (!cartItemId) return res.status(400).send('cartItemId가 없습니다.');

			await db.execute('DELETE FROM cart_items WHERE id = ?', [cartItemId]);
			return res.redirect('/shop/cart');
		}

		// 비로그인: 세션
		const guestCart = getGuestCart(req);
		delete guestCart.items[productId];

		return res.redirect('/shop/cart');
	} catch (err) {
		console.error(err);
		res.status(500).send('장바구니 삭제 중 오류');
	}
});
// 장바구니 전체 비우기
app.post('/shop/cart/clear', async (req, res) => {
	if (req.session.user) {
		const cartId = await ensureUserCartId(req.session.user.id);
		await db.execute('DELETE FROM cart_items WHERE cart_id = ?', [cartId]);
		return res.redirect('/shop/cart');
	}

	// 비회원
	req.session.guestCart = { items: {} };
	return res.redirect('/shop/cart');
});

/* -----------------------------
   관리자: 상품 등록/수정/삭제/엑셀 업로드
   (현재는 로그인만 체크. 실제론 관리자 권한 컬럼으로 제한 추천)
------------------------------*/
app.get('/admin/products/new', requireLogin, (req, res) => res.render('admin/admin-product-new'));

app.post('/admin/products/new', requireLogin, async (req, res) => {
	try {
		const { code, name, description, price, spec, image, category_id } = req.body;
		const priceValue = Number(price);

		if (!name) return res.send('상품명은 필수입니다.');
		if (Number.isNaN(priceValue) || priceValue <= 0) return res.send('가격은 0보다 큰 숫자여야 합니다.');

		await db.execute(
			`INSERT INTO products (code, name, description, price, spec, image, category_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[code || null, name, description || null, priceValue, spec || null, image || null, category_id ? Number(category_id) : null]
		);

		res.redirect('/shop/products');
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 등록 중 오류');
	}
});

app.get('/admin/products/import', requireLogin, (req, res) => res.render('admin/admin-product-import'));

app.post('/admin/products/import', requireLogin, upload.single('file'), async (req, res) => {
	try {
		if (!req.file) return res.send('업로드된 파일이 없습니다.');

		const workbook = xlsx.readFile(req.file.path);
		const sheet = workbook.Sheets[workbook.SheetNames[0]];
		const rows = xlsx.utils.sheet_to_json(sheet);

		// 헤더 예시: code, name, category_slug, price, spec, image, description
		for (const row of rows) {
			const { code, name, category_slug, price, spec, image, description } = row;
			if (!name) continue;

			// category_slug -> category_id
			let categoryId = null;
			if (category_slug) {
				const [cats] = await db.execute('SELECT id FROM categories WHERE slug = ? LIMIT 1', [category_slug]);
				if (cats.length > 0) categoryId = cats[0].id;
			}

			await db.execute(
				`
        INSERT INTO products (code, name, category_id, price, spec, image, description)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          category_id = VALUES(category_id),
          price = VALUES(price),
          spec = VALUES(spec),
          image = VALUES(image),
          description = VALUES(description)
        `,
				[code || null, name, categoryId, Number(price) || 0, spec || null, image || null, description || null]
			);
		}

		res.send('엑셀 업로드 및 상품 반영 완료!');
	} catch (err) {
		console.error(err);
		res.status(500).send('엑셀 처리 중 오류');
	}
});
// 게스트 장바구니를 로그인 시 사용자 장바구니로 병합하는 함수
async function mergeGuestCartToUserCart(req) {
	// guest cart 없으면 끝
	if (!req.session.guestCart || !req.session.guestCart.items) return;

	const userId = req.session.user?.id;
	if (!userId) return;

	const cartId = await ensureUserCartId(userId);

	const items = req.session.guestCart.items; // { productId: qty }
	const productIds = Object.keys(items);

	for (const pid of productIds) {
		const productId = Number(pid);
		const qty = Math.max(1, Number(items[pid]) || 1);

		// 이미 있으면 수량 증가, 없으면 insert
		const [exist] = await db.execute('SELECT id FROM cart_items WHERE cart_id = ? AND product_id = ? LIMIT 1', [cartId, productId]);

		if (exist.length) {
			await db.execute('UPDATE cart_items SET quantity = quantity + ? WHERE id = ?', [qty, exist[0].id]);
		} else {
			await db.execute('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)', [cartId, productId, qty]);
		}
	}

	// 합친 뒤 guest cart 비우기 (요구사항: 비회원은 다시 들어오면 초기화 느낌)
	req.session.guestCart = { items: {} };
}

/* -----------------------------
   서버 실행
------------------------------*/
app.listen(PORT, () => {
	console.log(`Server running at http://localhost:${PORT}`);
});
