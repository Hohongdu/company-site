require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const app = express();
const PORT = process.env.PORT || 3000;
const helmet = require('helmet');
const csurf = require('csurf');

const db = require('./db');
const { ensureUserCartId, getGuestCart } = require('./lib/cart');

const companyRouter = require('./routes/company');
const authRouter = require('./routes/auth');
const shopRouter = require('./routes/shop');
const adminRouter = require('./routes/admin');

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
// 1) helmet (CSP는 nginx에서 하니까 off 추천)
app.use(helmet({ contentSecurityPolicy: false }));
app.set('trust proxy', 1);

// 3) session (csurf보다 먼저!)
app.use(
	session({
		name: 'sid',
		secret: process.env.SESSION_SECRET,
		resave: false,
		saveUninitialized: false,
		cookie: {
			httpOnly: true,
			secure: 'auto', // ✅ 핵심 (req.secure 기반)
			sameSite: 'lax',
			maxAge: 1000 * 60 * 60 * 2,
		},
	}),
);

/**
 * 4) csurf
 *   - 전체에 걸면 개발 중 폼이 많은 곳에서 한 번에 다 깨질 수 있어서
 *   - 먼저 관리자(/admin) + 로그인(/auth) 같은 “폼 POST 많은 곳”에만 거는 걸 추천
 */
const csrfProtection = csurf({ ignoreMethods: ['GET', 'HEAD', 'OPTIONS'] });

// 관리자/인증 라우트에만 적용 (추천)
app.use('/admin', csrfProtection);
app.use('/auth', csrfProtection);

// EJS에서 csrfToken 쓰게 주입 (csrf 적용된 요청에서만 생성 가능)
app.use((req, res, next) => {
	// csurf가 걸린 경로에서만 req.csrfToken이 생김
	if (typeof req.csrfToken === 'function') {
		res.locals.csrfToken = req.csrfToken();
	}
	next();
});

// locals
app.use((req, res, next) => {
	res.locals.currentPath = req.path;
	res.locals.currentUrl = req.originalUrl;
	res.locals.user = req.session.user || null;
	next();
});

// cartCount 배지 계산(공통)
app.use(async (req, res, next) => {
	try {
		res.locals.cartCount = 0;

		if (req.session.user) {
			const cartId = await ensureUserCartId(req.session.user.id);
			const [rows] = await db.execute('SELECT COALESCE(SUM(quantity),0) AS cnt FROM cart_items WHERE cart_id = ?', [cartId]);
			res.locals.cartCount = Number(rows[0]?.cnt || 0);
			return next();
		}

		const items = getGuestCart(req).items || {};
		res.locals.cartCount = Object.values(items).reduce((s, v) => s + (Number(v) || 0), 0);

		return next();
	} catch (err) {
		console.error(err);
		return next();
	}
});

// view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

// 라우터 연결
app.use('/', companyRouter);
app.use('/auth', authRouter);
app.use('/shop', shopRouter);
app.use('/admin', adminRouter);
// ✅ API 라우팅 (RN 전용)
app.use('/api', require('./routes/api'));

// 404
app.use((req, res) => {
	res.status(404).render('404', {
		message: '페이지를 찾을 수 없습니다.',
		currentPath: req.path,
		currentUrl: req.originalUrl,
		user: req.session?.user || null,
	});
});

// 500 (에러 핸들러: 파라미터 4개여야 함)
app.use((err, req, res, next) => {
	console.error('SERVER ERROR:', err);

	// 오류 추적용 ID (로그와 매칭)
	const errorId = `E-${Date.now()}`;

	// 헤더가 이미 전송된 경우(드물지만) Express 기본 처리로 넘김
	if (res.headersSent) return next(err);

	res.status(500).render('500', {
		message: '서버 오류가 발생했습니다.',
		errorId,
		currentPath: req.path,
		currentUrl: req.originalUrl,
		user: req.session?.user || null,
	});
});
app.use((err, req, res, next) => {
	if (err && err.code === 'EBADCSRFTOKEN') {
		return res.status(403).send('CSRF 토큰이 유효하지 않습니다. 새로고침 후 다시 시도해주세요.');
	}
	next(err);
});

app.listen(PORT, () => {
	console.log(`Server running at http://localhost:${PORT}`);
});
