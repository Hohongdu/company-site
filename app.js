require('dotenv').config(); // 🔥 제일 첫 줄!

const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const db = require('./db');
const axios = require('axios');
const multer = require('multer');
const xlsx = require('xlsx');

const upload = multer({ dest: 'uploads/' });

const app = express();
const PORT = process.env.PORT || 3000;

// 카카오
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const KAKAO_ADMIN_KEY = process.env.KAKAO_ADMIN_KEY;
const KAKAO_CID = process.env.KAKAO_CID || 'TC0ONETIME';

// 네이버
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const NAVER_MERCHANT_ID = process.env.NAVER_MERCHANT_ID;

// 토스

// 폼 데이터 파싱 (POST form용)
app.use(express.urlencoded({ extended: true }));

// 🔥 세션 미들웨어
app.use(
	session({
		secret: '슈퍼_시크릿_키_나중에_env로_뺄것', // 나중에 .env로 빼기
		resave: false,
		saveUninitialized: false,
		cookie: {
			maxAge: 1000 * 60 * 60, // 1시간
		},
	})
);

app.use((req, res, next) => {
	res.locals.currentPath = req.path;
	res.locals.user = req.session.user || null;
	next();
});

// 뷰 엔진 설정
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 정적 파일
app.use(express.static(path.join(__dirname, 'public')));

// 라우트
app.get('/', (req, res) => {
	res.render('index');
});

app.get('/about', (req, res) => {
	res.render('about');
});

app.get('/contact', (req, res) => {
	res.render('contact');
});

app.get('/login', (req, res) => {
	res.render('login');
});

app.get('/register', (req, res) => {
	res.render('register');
});

app.get('/logout', (req, res) => {
	req.session.destroy((err) => {
		if (err) {
			console.error(err);
		}
		res.clearCookie('connect.sid'); // 세션 쿠키 삭제
		return res.redirect('/');
	});
});

// 🔥 상품 상세 페이지
app.get('/products/:id', async (req, res) => {
	try {
		const productId = Number(req.params.id);

		const [rows] = await db.execute('SELECT * FROM products WHERE id = ? LIMIT 1', [productId]);

		if (rows.length === 0) {
			return res.status(404).render('404', {
				message: '해당 상품을 찾을 수 없습니다.',
			});
		}

		const product = rows[0];
		res.render('product-detail', { product });
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 정보를 불러오는 중 오류가 발생했습니다.');
	}
});

app.listen(PORT, () => {
	console.log(`Server running at http://localhost:${PORT}`);
});

// 회원가입 처리
app.post('/register', async (req, res) => {
	try {
		const { name, email, password, passwordConfirm } = req.body;

		// 비밀번호 확인
		if (password !== passwordConfirm) {
			return res.send('비밀번호가 일치하지 않습니다.');
		}

		// 비밀번호 암호화
		const hashedPw = await bcrypt.hash(password, 10);

		// DB 저장
		await db.execute(`INSERT INTO users (name, email, password) VALUES (?, ?, ?)`, [name, email, hashedPw]);

		return res.send('회원가입 완료! (나중에 성공 페이지로 이동 가능)');
	} catch (err) {
		console.error(err);
		return res.send('회원가입 중 오류 발생');
	}
});

// 로그인 처리
app.post('/login', async (req, res) => {
	try {
		const { email, password } = req.body;

		const [rows] = await db.execute(`SELECT * FROM users WHERE email = ? LIMIT 1`, [email]);

		if (rows.length === 0) {
			return res.send('존재하지 않는 이메일입니다.');
		}

		const user = rows[0];

		const isMatch = await bcrypt.compare(password, user.password);

		if (!isMatch) {
			return res.send('비밀번호가 일치하지 않습니다.');
		}

		// 🔥 로그인 성공 → 세션에 유저 정보 저장
		req.session.user = {
			id: user.id,
			name: user.name,
			email: user.email,
		};

		// 나중엔 마이페이지나 메인으로 리다이렉트
		return res.redirect('/');
	} catch (err) {
		console.error(err);
		return res.send('로그인 중 오류');
	}
});

// 상품 등록 폼 (관리자/로그인 사용자용)
app.get('/admin/products/new', requireLogin, (req, res) => {
	res.render('admin-product-new');
});

// 상품 등록 처리
app.post('/admin/products/new', requireLogin, async (req, res) => {
	try {
		const { name, description, price, image } = req.body;

		// 가격을 숫자로 변환
		const priceValue = Number(price);
		if (Number.isNaN(priceValue) || priceValue <= 0) {
			return res.send('가격은 0보다 큰 숫자여야 합니다.');
		}

		await db.execute(`INSERT INTO products (name, description, price, image) VALUES (?, ?, ?, ?)`, [name, description, priceValue, image || null]);

		// 등록 후 상품 목록으로 이동
		res.redirect('/products');
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 등록 중 오류가 발생했습니다.');
	}
});

// 로그인된 사용자만 접근 허용하는 미들웨어
function requireLogin(req, res, next) {
	if (!req.session.user) {
		return res.redirect('/login');
	}
	next();
}
// 상품 수정 폼
app.get('/admin/products/:id/edit', requireLogin, async (req, res) => {
	try {
		const productId = Number(req.params.id);

		const [rows] = await db.execute('SELECT * FROM products WHERE id = ? LIMIT 1', [productId]);

		if (rows.length === 0) {
			return res.status(404).render('404', { message: '상품을 찾을 수 없습니다.' });
		}

		const product = rows[0];
		res.render('admin-product-edit', { product });
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 정보를 불러오는 중 오류가 발생했습니다.');
	}
});

// 상품 수정 처리
app.post('/admin/products/:id/edit', requireLogin, async (req, res) => {
	try {
		const productId = Number(req.params.id);
		const { name, description, price, image } = req.body;

		const priceValue = Number(price);
		if (Number.isNaN(priceValue) || priceValue <= 0) {
			return res.send('가격은 0보다 큰 숫자여야 합니다.');
		}

		await db.execute(
			`UPDATE products
       SET name = ?, description = ?, price = ?, image = ?
       WHERE id = ?`,
			[name, description, priceValue, image || null, productId]
		);

		res.redirect('/products/' + productId);
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 수정 중 오류가 발생했습니다.');
	}
});

// 상품 삭제 처리
app.post('/admin/products/:id/delete', requireLogin, async (req, res) => {
	try {
		const productId = Number(req.params.id);

		await db.execute('DELETE FROM products WHERE id = ?', [productId]);

		res.redirect('/products');
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 삭제 중 오류가 발생했습니다.');
	}
});
// 주문 생성
app.post('/orders', requireLogin, async (req, res) => {
	try {
		const { productId } = req.body;
		const userId = req.session.user.id;

		// 1) 상품 정보 조회
		const [rows] = await db.execute('SELECT * FROM products WHERE id = ? LIMIT 1', [productId]);

		if (rows.length === 0) {
			return res.status(404).render('404', { message: '상품을 찾을 수 없습니다.' });
		}

		const product = rows[0];

		// 2) 주문 생성 (PENDING 상태)
		const [result] = await db.execute(
			`INSERT INTO orders (user_id, product_id, amount, status)
       VALUES (?, ?, ?, 'PENDING')`,
			[userId, product.id, product.price]
		);

		const orderId = result.insertId;

		// 3) 일단은 "주문 상세 페이지"로 이동 (나중에 여기에서 PG 연동)
		res.redirect('/orders/' + orderId);
	} catch (err) {
		console.error(err);
		res.status(500).send('주문 생성 중 오류가 발생했습니다.');
	}
});
// 주문 상세 보기
app.get('/orders/:id', requireLogin, async (req, res) => {
	try {
		const orderId = Number(req.params.id);
		const userId = req.session.user.id;

		const [rows] = await db.execute(
			`SELECT o.*, p.name AS product_name, p.description AS product_description, p.image AS product_image
       FROM orders o
       JOIN products p ON o.product_id = p.id
       WHERE o.id = ? AND o.user_id = ?
       LIMIT 1`,
			[orderId, userId]
		);

		if (rows.length === 0) {
			return res.status(404).render('404', { message: '주문을 찾을 수 없습니다.' });
		}

		const order = rows[0];

		res.render('order-detail', { order });
	} catch (err) {
		console.error(err);
		res.status(500).send('주문 정보를 불러오는 중 오류가 발생했습니다.');
	}
});

// 장바구니 보기
app.get('/cart', requireLogin, async (req, res) => {
	try {
		const userId = req.session.user.id;

		const [rows] = await db.execute(
			`SELECT ci.id AS cart_item_id,
              ci.quantity,
              p.id AS product_id,
              p.name,
              p.price,
              p.image
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.user_id = ?`,
			[userId]
		);

		// 총 합계 계산
		let totalAmount = 0;
		rows.forEach((item) => {
			totalAmount += item.price * item.quantity;
		});

		res.render('cart', { items: rows, totalAmount });
	} catch (err) {
		console.error(err);
		res.status(500).send('장바구니를 불러오는 중 오류가 발생했습니다.');
	}
});
// 장바구니에 담기
app.post('/cart/add', requireLogin, async (req, res) => {
	try {
		const { productId, quantity } = req.body;
		const userId = req.session.user.id;

		const productIdNum = Number(productId);
		const qty = Number(quantity) || 1;

		if (!productIdNum || qty <= 0) {
			return res.status(400).send('잘못된 요청입니다.');
		}

		// 이미 있으면 수량 +, 없으면 새로 추가
		await db.execute(
			`INSERT INTO cart_items (user_id, product_id, quantity)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         quantity = quantity + VALUES(quantity)`,
			[userId, productIdNum, qty]
		);

		return res.redirect('/cart'); // 혹은 'back'으로 돌려보내도 됨
	} catch (err) {
		console.error(err);
		res.status(500).send('장바구니 담기 중 오류가 발생했습니다.');
	}
});
// 장바구니 수량 수정
app.post('/cart/update', requireLogin, async (req, res) => {
	try {
		const { cartItemId, quantity } = req.body;
		const userId = req.session.user.id;

		const idNum = Number(cartItemId);
		const qty = Number(quantity);

		if (!idNum) {
			return res.status(400).send('잘못된 요청입니다.');
		}

		if (!qty || qty <= 0) {
			// 수량 0 이하면 항목 삭제
			await db.execute(`DELETE FROM cart_items WHERE id = ? AND user_id = ?`, [idNum, userId]);
		} else {
			await db.execute(
				`UPDATE cart_items
         SET quantity = ?
         WHERE id = ? AND user_id = ?`,
				[qty, idNum, userId]
			);
		}

		return res.redirect('/cart');
	} catch (err) {
		console.error(err);
		res.status(500).send('장바구니 수정 중 오류가 발생했습니다.');
	}
});
// 장바구니 항목 삭제
app.post('/cart/remove', requireLogin, async (req, res) => {
	try {
		const { cartItemId } = req.body;
		const userId = req.session.user.id;

		const idNum = Number(cartItemId);
		if (!idNum) {
			return res.status(400).send('잘못된 요청입니다.');
		}

		await db.execute(`DELETE FROM cart_items WHERE id = ? AND user_id = ?`, [idNum, userId]);

		return res.redirect('/cart');
	} catch (err) {
		console.error(err);
		res.status(500).send('장바구니 삭제 중 오류가 발생했습니다.');
	}
});

// 결제 준비 (1단계: 모의 결제용)
app.post('/payments/ready', requireLogin, async (req, res) => {
	try {
		const { orderId, method } = req.body;
		const userId = req.session.user.id;

		// 1) 주문 + 상품 정보 조회
		const [rows] = await db.execute(
			`SELECT o.*, p.name AS product_name, p.price AS product_price
       FROM orders o
       JOIN products p ON o.product_id = p.id
       WHERE o.id = ? AND o.user_id = ? LIMIT 1`,
			[orderId, userId]
		);

		if (rows.length === 0) {
			return res.status(404).render('404', { message: '주문을 찾을 수 없습니다.' });
		}

		const order = rows[0];

		// 2) PG 분기
		if (method === 'KAKAO') {
			// 🔥 카카오페이 결제 준비 API 호출
			const kakaoResponse = await axios.post(
				'https://kapi.kakao.com/v1/payment/ready',
				new URLSearchParams({
					cid: KAKAO_CID,
					partner_order_id: String(order.id),
					partner_user_id: String(userId),
					item_name: order.product_name,
					quantity: '1',
					total_amount: String(order.product_price),
					vat_amount: '0',
					tax_free_amount: '0',
					approval_url: `${BASE_URL}/payments/kakao/success?orderId=${order.id}`,
					cancel_url: `${BASE_URL}/payments/kakao/cancel?orderId=${order.id}`,
					fail_url: `${BASE_URL}/payments/kakao/fail?orderId=${order.id}`,
				}).toString(),
				{
					headers: {
						'Authorization': `KakaoAK ${KAKAO_ADMIN_KEY}`,
						'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
					},
				}
			);

			const { tid, next_redirect_pc_url } = kakaoResponse.data;

			// tid를 orders 테이블에 저장 (추후 approve에서 사용)
			await db.execute(
				`UPDATE orders
         SET pg_tid = ?, payment_method = 'KAKAO'
         WHERE id = ?`,
				[tid, order.id]
			);

			// 카카오 결제 페이지로 리다이렉트
			return res.redirect(next_redirect_pc_url);
		}

		// 네이버/토스는 나중에 여기서 추가
		if (method === 'NAVER') {
			return res.send('네이버페이 연동은 준비중입니다.');
		}

		if (method === 'TOSS') {
			return res.send('토스페이 연동은 준비중입니다.');
		}

		return res.status(400).send('지원하지 않는 결제 수단입니다.');
	} catch (err) {
		console.error(err.response?.data || err);
		res.status(500).send('결제 준비 중 오류가 발생했습니다.');
	}
});
// 카카오페이 결제 성공 콜백
app.get('/payments/kakao/success', requireLogin, async (req, res) => {
	try {
		const { pg_token, orderId } = req.query;
		const userId = req.session.user.id;

		if (!pg_token || !orderId) {
			return res.status(400).send('잘못된 요청입니다.');
		}

		// 1) 주문에서 tid 가져오기
		const [rows] = await db.execute(`SELECT * FROM orders WHERE id = ? AND user_id = ? LIMIT 1`, [orderId, userId]);

		if (rows.length === 0) {
			return res.status(404).render('404', { message: '주문을 찾을 수 없습니다.' });
		}

		const order = rows[0];

		if (!order.pg_tid) {
			return res.status(400).send('결제 정보(tid)가 없습니다.');
		}

		// 2) 결제 승인 API 호출
		const approveResponse = await axios.post(
			'https://kapi.kakao.com/v1/payment/approve',
			new URLSearchParams({
				cid: KAKAO_CID,
				tid: order.pg_tid,
				partner_order_id: String(order.id),
				partner_user_id: String(userId),
				pg_token,
			}).toString(),
			{
				headers: {
					'Authorization': `KakaoAK ${KAKAO_ADMIN_KEY}`,
					'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
				},
			}
		);

		// approveResponse.data 안에는 결제 상세 정보가 들어있음 (amount, card info 등)
		console.log('KakaoPay approve result:', approveResponse.data);

		// 3) 주문 상태 업데이트
		await db.execute(
			`UPDATE orders
       SET status = 'PAID',
           paid_at = NOW()
       WHERE id = ?`,
			[order.id]
		);

		// 4) 주문 상세 페이지로 이동
		return res.redirect('/orders/' + order.id);
	} catch (err) {
		console.error(err.response?.data || err);
		res.status(500).send('결제 승인 중 오류가 발생했습니다.');
	}
});
// 카카오페이 결제 취소
app.get('/payments/kakao/cancel', requireLogin, async (req, res) => {
	const { orderId } = req.query;
	// 필요하면 orders.status 를 'CANCELED'로 업데이트 가능
	if (orderId) {
		await db.execute(
			`UPDATE orders
       SET status = 'CANCELED'
       WHERE id = ?`,
			[orderId]
		);
	}
	return res.send('결제가 취소되었습니다. (나중에 예쁜 화면으로 교체 가능)');
});
// 카카오페이 결제 실패
app.get('/payments/kakao/fail', requireLogin, async (req, res) => {
	const { orderId } = req.query;
	if (orderId) {
		await db.execute(
			`UPDATE orders
       SET status = 'CANCELED'
       WHERE id = ?`,
			[orderId]
		);
	}
	return res.send('결제가 실패했습니다. (나중에 예쁜 화면으로 교체 가능)');
});
// 카테고리 필터
app.get('/products', async (req, res) => {
	try {
		const categorySlug = req.query.category || 'all';

		const [categoryRows] = await db.execute('SELECT * FROM categories ORDER BY name ASC');

		let sql = `SELECT p.*, c.name AS category_name, c.slug AS category_slug
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id`;
		const params = [];

		if (categorySlug !== 'all') {
			sql += ' WHERE c.slug = ?';
			params.push(categorySlug);
		}

		sql += ' ORDER BY p.created_at DESC';

		const [productRows] = await db.execute(sql, params);

		res.render('products', {
			products: productRows,
			categories: categoryRows,
			currentCategory: categorySlug,
		});
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 목록을 불러오는 중 오류가 발생했습니다.');
	}
});
// 엑셀 업로드 폼
app.get('/admin/products/import', requireLogin, (req, res) => {
	res.render('admin-product-import'); // 폼 페이지
});
// 엑셀 업로드 처리
app.post('/admin/products/import', requireLogin, upload.single('file'), async (req, res) => {
	try {
		if (!req.file) {
			return res.send('업로드된 파일이 없습니다.');
		}

		const workbook = xlsx.readFile(req.file.path);
		const sheet = workbook.Sheets[workbook.SheetNames[0]];
		const rows = xlsx.utils.sheet_to_json(sheet);

		// 엑셀 헤더 예시:
		// code, name, category_slug, price, spec, image, description
		for (const row of rows) {
			const { code, name, category_slug, price, spec, image, description } = row;

			if (!code || !name) continue; // 최소 조건

			// category_slug → category_id 찾기
			let categoryId = null;
			if (category_slug) {
				const [cats] = await db.execute('SELECT id FROM categories WHERE slug = ? LIMIT 1', [category_slug]);
				if (cats.length > 0) {
					categoryId = cats[0].id;
				}
			}

			// upsert: code 기준으로 있으면 UPDATE, 없으면 INSERT
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

		return res.send('엑셀 업로드 및 상품 정보 반영 완료!');
	} catch (err) {
		console.error(err);
		return res.status(500).send('엑셀 처리 중 오류가 발생했습니다.');
	}
});
