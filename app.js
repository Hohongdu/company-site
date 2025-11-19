const bcrypt = require('bcrypt');
const db = require('./db');
const session = require('express-session');
const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;
const axios = require('axios'); // 맨 위에 추가 (나중에 실제 PG 연동에 사용)
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

// 🔥 모든 뷰에서 currentPath 사용 가능하게
app.use((req, res, next) => {
	res.locals.currentPath = req.path;
	next();
});

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

app.get('/products', async (req, res) => {
	try {
		const [rows] = await db.execute('SELECT * FROM products ORDER BY created_at DESC');

		res.render('products', { products: rows });
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 목록을 불러오는 중 오류가 발생했습니다.');
	}
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
// 결제 준비 (1단계: 모의 결제용)
app.post('/payments/ready', requireLogin, async (req, res) => {
	try {
		const { orderId, method } = req.body;
		const userId = req.session.user.id;

		// 1) 주문 조회
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

		// 아직은 실제 PG 연동 없이, 바로 결제 완료로 처리 (모의)
		// 나중에 이 자리에 카카오/네이버/토스 API 요청을 넣을 것

		// 2) 주문 상태를 PAID로 변경 (모의 결제)
		await db.execute(
			`UPDATE orders
       SET status = 'PAID',
           payment_method = ?,
           pg_tid = ?,
           paid_at = NOW()
       WHERE id = ?`,
			[method, 'MOCK_TID_' + Date.now(), orderId]
		);

		// 3) 다시 주문 상세 페이지로 이동
		return res.redirect('/orders/' + orderId);
	} catch (err) {
		console.error(err);
		res.status(500).send('결제 처리 중 오류가 발생했습니다.');
	}
});
