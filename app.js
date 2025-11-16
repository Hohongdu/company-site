const bcrypt = require('bcrypt');
const db = require('./db');
const session = require('express-session');
const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

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

// 임시 상품 데이터
const products = [
	{ id: 1, name: '상품 A', price: 19000, description: '기본 설명 텍스트입니다.', image: null },
	{ id: 2, name: '상품 B', price: 29000, description: '여기에 상품 특징 등을 적습니다.', image: null },
	{ id: 3, name: '상품 C', price: 39000, description: '나중에 실제 이미지 경로도 넣을 수 있어요.', image: null },
];

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

app.get('/products', (req, res) => {
	res.render('products', { products });
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
app.get('/products/:id', (req, res) => {
	const productId = Number(req.params.id);
	const product = products.find((p) => p.id === productId);

	if (!product) {
		// 나중에 예쁜 404 페이지로 바꾸면 됨
		return res.status(404).render('404', {
			message: '해당 상품을 찾을 수 없습니다.',
		});
	}

	res.render('product-detail', { product });
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
