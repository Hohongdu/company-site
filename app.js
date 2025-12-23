// app.js
require('dotenv').config(); // 🔥 제일 첫 줄

const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const db = require('./db');

const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');

const upload = multer({ dest: 'uploads/' });

const app = express();
const PORT = process.env.PORT || 3000;

// ===== 기본 미들웨어 =====
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 세션
app.use(
	session({
		secret: process.env.SESSION_SECRET || '슈퍼_시크릿_키_나중에_env로_뺄것',
		resave: false,
		saveUninitialized: false,
		cookie: { maxAge: 1000 * 60 * 60 }, // 1시간
	})
);

// 정적파일
app.use(express.static(path.join(__dirname, 'public')));

// 뷰 엔진
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// res.locals 공통
app.use((req, res, next) => {
	res.locals.currentPath = req.path;
	res.locals.user = req.session.user || null;
	next();
});

// ===== 헬퍼 =====
function requireLogin(req, res, next) {
	if (!req.session.user) return res.redirect('/auth/login');
	next();
}

// 비회원 장바구니 세션 초기값
function getGuestCart(req) {
	if (!req.session.guestCart) req.session.guestCart = []; // [{productId, quantity}]
	return req.session.guestCart;
}

// ===============================
// 1) 회사(소개) 영역
// ===============================
app.get('/', (req, res) => {
	// 기존 index.ejs를 company/index.ejs로 옮기는 걸 추천
	res.render('company/index');
});

// 기존(구조 변경 전) URL 호환 - 예전 링크/즐겨찾기 깨짐 방지
app.get('/products', (req, res) => res.redirect(301, '/shop/products'));
app.get('/products/:id', (req, res) => res.redirect(301, `/shop/products/${req.params.id}`));
app.get('/cart', (req, res) => res.redirect(301, '/shop/cart'));
app.get('/login', (req, res) => res.redirect(301, '/auth/login'));
app.get('/register', (req, res) => res.redirect(301, '/auth/register'));
app.get('/logout', (req, res) => res.redirect(301, '/auth/logout'));

app.get('/about', (req, res) => {
	res.render('company/about');
});

app.get('/contact', (req, res) => {
	res.render('company/contact');
});

// ===============================
// 2) 인증(Auth) 영역
// ===============================
app.get('/auth/login', (req, res) => {
	res.render('auth/login');
});

app.get('/auth/register', (req, res) => {
	res.render('auth/register');
});

app.get('/auth/logout', (req, res) => {
	req.session.destroy((err) => {
		if (err) console.error(err);
		res.clearCookie('connect.sid');
		return res.redirect('/');
	});
});

// 회원가입 처리
app.post('/auth/register', async (req, res) => {
	try {
		const { name, email, password, passwordConfirm } = req.body;

		if (password !== passwordConfirm) {
			return res.send('비밀번호가 일치하지 않습니다.');
		}

		const hashedPw = await bcrypt.hash(password, 10);

		await db.execute('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', [name, email, hashedPw]);

		return res.redirect('/auth/login');
	} catch (err) {
		console.error(err);
		return res.status(500).send('회원가입 중 오류 발생');
	}
});

// 로그인 처리
app.post('/auth/login', async (req, res) => {
	try {
		const { email, password } = req.body;

		const [rows] = await db.execute('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);

		if (rows.length === 0) return res.send('존재하지 않는 이메일입니다.');

		const user = rows[0];
		const isMatch = await bcrypt.compare(password, user.password);

		if (!isMatch) return res.send('비밀번호가 일치하지 않습니다.');

		req.session.user = { id: user.id, name: user.name, email: user.email };

		// ✅ (선택) 로그인 시 비회원 장바구니를 DB 장바구니로 합치고 싶다면 여기서 처리 가능
		// 지금은 요구사항에 없어서 생략(원하면 다음 단계에서 붙여줌)

		return res.redirect('/'); // 회사 메인으로
	} catch (err) {
		console.error(err);
		return res.status(500).send('로그인 중 오류');
	}
});

// ===============================
// 3) 상품몰(Shop) 영역 - 완전 분리
// ===============================

// (선택) /shop 진입 시 상품 리스트로
app.get('/shop', (req, res) => res.redirect('/shop/products'));

// 상품 리스트 + 카테고리 필터
// GET /shop/products?category=all 또는 ?category=metal 이런 식
app.get('/shop/products', async (req, res) => {
	try {
		const categorySlug = req.query.category || 'all';

		// 카테고리 목록
		const [categoryRows] = await db.execute('SELECT * FROM categories ORDER BY name ASC');

		let sql = `
      SELECT p.*, c.name AS category_name, c.slug AS category_slug
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
    `;
		const params = [];

		if (categorySlug !== 'all') {
			sql += ' WHERE c.slug = ?';
			params.push(categorySlug);
		}

		sql += ' ORDER BY p.created_at DESC';

		const [productRows] = await db.execute(sql, params);

		res.render('shop/products', {
			products: productRows,
			categories: categoryRows,
			currentCategory: categorySlug,
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

		const [rows] = await db.execute('SELECT * FROM products WHERE id = ? LIMIT 1', [productId]);

		if (rows.length === 0) {
			return res.status(404).render('404', { message: '상품을 찾을 수 없습니다.' });
		}

		res.render('shop/product-detail', { product: rows[0] });
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 정보를 불러오는 중 오류가 발생했습니다.');
	}
});

// ===============================
// 4) 장바구니(Cart) - 회원/비회원 모두
// ===============================

// 장바구니 보기
app.get('/shop/cart', async (req, res) => {
	try {
		// ✅ 회원이면 DB 장바구니
		if (req.session.user) {
			const userId = req.session.user.id;

			const [rows] = await db.execute(
				`
        SELECT ci.id AS cart_item_id,
               ci.quantity,
               p.id AS product_id,
               p.name,
               p.price,
               p.image
        FROM cart_items ci
        JOIN products p ON ci.product_id = p.id
        WHERE ci.user_id = ?
        ORDER BY ci.updated_at DESC
        `,
				[userId]
			);

			const totalAmount = rows.reduce((sum, item) => sum + item.price * item.quantity, 0);

			return res.render('shop/cart', {
				items: rows,
				totalAmount,
				isGuest: false,
			});
		}

		// ✅ 비회원이면 세션 장바구니 (브라우저 세션 끝나면 초기화됨)
		const guestCart = getGuestCart(req);

		// 상품 정보 merge (한 번에 조회)
		const productIds = guestCart.map((i) => i.productId);
		let items = [];

		if (productIds.length > 0) {
			const placeholders = productIds.map(() => '?').join(',');
			const [products] = await db.execute(`SELECT id, name, price, image FROM products WHERE id IN (${placeholders})`, productIds);

			const productMap = new Map(products.map((p) => [p.id, p]));

			items = guestCart
				.map((ci) => {
					const p = productMap.get(ci.productId);
					if (!p) return null;
					return {
						cart_item_id: `GUEST-${ci.productId}`, // 화면용
						product_id: p.id,
						name: p.name,
						price: p.price,
						image: p.image,
						quantity: ci.quantity,
					};
				})
				.filter(Boolean);
		}

		const totalAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

		return res.render('shop/cart', {
			items,
			totalAmount,
			isGuest: true,
		});
	} catch (err) {
		console.error(err);
		res.status(500).send('장바구니를 불러오는 중 오류가 발생했습니다.');
	}
});

// 장바구니 추가
app.post('/shop/cart/add', async (req, res) => {
	try {
		const { productId, quantity } = req.body;

		const pid = Number(productId);
		const qty = Number(quantity) || 1;

		if (!pid || qty <= 0) return res.status(400).send('잘못된 요청입니다.');

		// ✅ 회원: DB
		if (req.session.user) {
			const userId = req.session.user.id;

			await db.execute(
				`
        INSERT INTO cart_items (user_id, product_id, quantity)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
          quantity = quantity + VALUES(quantity)
        `,
				[userId, pid, qty]
			);

			return res.redirect('/shop/cart');
		}

		// ✅ 비회원: 세션
		const guestCart = getGuestCart(req);
		const existing = guestCart.find((i) => i.productId === pid);

		if (existing) existing.quantity += qty;
		else guestCart.push({ productId: pid, quantity: qty });

		return res.redirect('/shop/cart');
	} catch (err) {
		console.error(err);
		res.status(500).send('장바구니 담기 중 오류가 발생했습니다.');
	}
});

// 장바구니 수량 변경
app.post('/shop/cart/update', async (req, res) => {
	try {
		const { cartItemId, productId, quantity } = req.body;
		const qty = Number(quantity);

		if (!qty || qty <= 0) {
			// qty가 0 이하이면 삭제로 처리
			req.body.cartItemId = cartItemId;
			req.body.productId = productId;
			return app._router.handle(req, res, () => {}, 'post', '/shop/cart/remove');
		}

		// ✅ 회원: DB
		if (req.session.user) {
			const userId = req.session.user.id;
			const idNum = Number(cartItemId);

			if (!idNum) return res.status(400).send('잘못된 요청입니다.');

			await db.execute(`UPDATE cart_items SET quantity = ? WHERE id = ? AND user_id = ?`, [qty, idNum, userId]);

			return res.redirect('/shop/cart');
		}

		// ✅ 비회원: 세션 (productId로 업데이트)
		const pid = Number(productId);
		if (!pid) return res.status(400).send('잘못된 요청입니다.');

		const guestCart = getGuestCart(req);
		const item = guestCart.find((i) => i.productId === pid);
		if (item) item.quantity = qty;

		return res.redirect('/shop/cart');
	} catch (err) {
		console.error(err);
		res.status(500).send('장바구니 수정 중 오류가 발생했습니다.');
	}
});

// 장바구니 삭제
app.post('/shop/cart/remove', async (req, res) => {
	try {
		const { cartItemId, productId } = req.body;

		// ✅ 회원: DB
		if (req.session.user) {
			const userId = req.session.user.id;
			const idNum = Number(cartItemId);

			if (!idNum) return res.status(400).send('잘못된 요청입니다.');

			await db.execute(`DELETE FROM cart_items WHERE id = ? AND user_id = ?`, [idNum, userId]);

			return res.redirect('/shop/cart');
		}

		// ✅ 비회원: 세션 (productId 기준으로 제거)
		const pid = Number(productId);
		if (!pid) return res.status(400).send('잘못된 요청입니다.');

		const guestCart = getGuestCart(req);
		req.session.guestCart = guestCart.filter((i) => i.productId !== pid);

		return res.redirect('/shop/cart');
	} catch (err) {
		console.error(err);
		res.status(500).send('장바구니 삭제 중 오류가 발생했습니다.');
	}
});

// ===============================
// 5) 관리자(Admin) - 상품 등록/수정/삭제/엑셀 업로드
//    (로그인 사용자만 접근)
// ===============================

// 상품 등록 폼
app.get('/admin/products/new', requireLogin, (req, res) => {
	res.render('admin/admin-product-new');
});

// 상품 등록 처리
app.post('/admin/products/new', requireLogin, async (req, res) => {
	try {
		const { code, name, description, price, image, category_id, spec } = req.body;

		const priceValue = Number(price);
		if (Number.isNaN(priceValue) || priceValue <= 0) {
			return res.send('가격은 0보다 큰 숫자여야 합니다.');
		}

		const categoryId = category_id ? Number(category_id) : null;

		await db.execute(
			`INSERT INTO products (code, name, description, price, image, category_id, spec)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[code || null, name, description || null, priceValue, image || null, categoryId, spec || null]
		);

		res.redirect('/shop/products');
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 등록 중 오류가 발생했습니다.');
	}
});

// 상품 수정 폼
app.get('/admin/products/:id/edit', requireLogin, async (req, res) => {
	try {
		const productId = Number(req.params.id);

		const [rows] = await db.execute('SELECT * FROM products WHERE id = ? LIMIT 1', [productId]);

		if (rows.length === 0) {
			return res.status(404).render('404', { message: '상품을 찾을 수 없습니다.' });
		}

		res.render('admin/admin-product-edit', { product: rows[0] });
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 정보를 불러오는 중 오류가 발생했습니다.');
	}
});

// 상품 수정 처리
app.post('/admin/products/:id/edit', requireLogin, async (req, res) => {
	try {
		const productId = Number(req.params.id);
		const { code, name, description, price, image, category_id, spec } = req.body;

		const priceValue = Number(price);
		if (Number.isNaN(priceValue) || priceValue <= 0) {
			return res.send('가격은 0보다 큰 숫자여야 합니다.');
		}

		const categoryId = category_id ? Number(category_id) : null;

		await db.execute(
			`UPDATE products
       SET code = ?, name = ?, description = ?, price = ?, image = ?, category_id = ?, spec = ?
       WHERE id = ?`,
			[code || null, name, description || null, priceValue, image || null, categoryId, spec || null, productId]
		);

		res.redirect('/shop/products/' + productId);
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 수정 중 오류가 발생했습니다.');
	}
});

// 상품 삭제
app.post('/admin/products/:id/delete', requireLogin, async (req, res) => {
	try {
		const productId = Number(req.params.id);

		await db.execute('DELETE FROM products WHERE id = ?', [productId]);

		res.redirect('/shop/products');
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 삭제 중 오류가 발생했습니다.');
	}
});

// 엑셀 업로드 폼
app.get('/admin/products/import', requireLogin, (req, res) => {
	res.render('admin/admin-product-import');
});

// 엑셀 업로드 처리
app.post('/admin/products/import', requireLogin, upload.single('file'), async (req, res) => {
	try {
		if (!req.file) return res.send('업로드된 파일이 없습니다.');

		const workbook = xlsx.readFile(req.file.path);
		const sheet = workbook.Sheets[workbook.SheetNames[0]];
		const rows = xlsx.utils.sheet_to_json(sheet);

		// 엑셀 헤더 예시:
		// code, name, category_slug, price, spec, image, description
		for (const row of rows) {
			const { code, name, category_slug, price, spec, image, description } = row;
			if (!code || !name) continue;

			let categoryId = null;
			if (category_slug) {
				const [cats] = await db.execute('SELECT id FROM categories WHERE slug = ? LIMIT 1', [category_slug]);
				if (cats.length > 0) categoryId = cats[0].id;
			}

			await db.execute(
				`INSERT INTO products (code, name, category_id, price, spec, image, description)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             category_id = VALUES(category_id),
             price = VALUES(price),
             spec = VALUES(spec),
             image = VALUES(image),
             description = VALUES(description)`,
				[code, name, categoryId, Number(price) || 0, spec || null, image || null, description || null]
			);
		}

		// 업로드된 임시파일 삭제
		fs.unlink(req.file.path, () => {});

		return res.send('엑셀 업로드 및 상품 정보 반영 완료!');
	} catch (err) {
		console.error(err);
		return res.status(500).send('엑셀 처리 중 오류가 발생했습니다.');
	}
});

// ===============================
// 6) 404 / 에러 처리
// ===============================
app.use((req, res) => {
	res.status(404).render('404', { message: '페이지를 찾을 수 없습니다.' });
});

// 서버 실행
app.listen(PORT, () => {
	console.log(`Server running at http://localhost:${PORT}`);
});
