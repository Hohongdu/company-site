// app.js
const path = require('path');

// ✅ dotenv: 실행 위치(CWD) 꼬임 방지 위해 절대경로로 로드
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const csurf = require('csurf');

const db = require('./db');
const { ensureUserCartId, getGuestCart } = require('./lib/cart');

const companyRouter = require('./routes/company');
const authRouter = require('./routes/auth');
const shopRouter = require('./routes/shop');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = Number(process.env.PORT || 3000);

// =====================
// 기본 설정
// =====================

// ✅ Nginx 뒤에서는 trust proxy를 세션보다 먼저(secure:auto가 req.secure 판단에 필요)
app.set('trust proxy', 1);

// 파서/정적
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 보안 헤더(상세 CSP는 Nginx에서 관리하므로 비활성)
app.use(helmet({ contentSecurityPolicy: false }));

// =====================
// 세션
// =====================
if (!process.env.SESSION_SECRET) {
	console.warn('[WARN] SESSION_SECRET is empty. Set it in .env for production safety.');
}

app.use(
	session({
		name: 'sid',
		secret: process.env.SESSION_SECRET || 'change_me_in_env',
		resave: false,
		saveUninitialized: false,
		cookie: {
			httpOnly: true,
			// ✅ 가장 안정적 (Nginx/HTTPS 프록시 환경)
			secure: 'auto',
			sameSite: 'lax',
			maxAge: 1000 * 60 * 60 * 2, // 2 hours
		},
	}),
);

// =====================
// CSRF (admin/auth만)
// =====================
const csrfProtection = csurf({
	ignoreMethods: ['GET', 'HEAD', 'OPTIONS'],
});

app.use('/auth', csrfProtection);
app.use('/admin', (req, res, next) => {
	if (req.method === 'GET' || !req.is('multipart/form-data')) {
		return csrfProtection(req, res, next);
	}
	return next();
});

// EJS에서 csrfToken 바로 사용 가능하게 주입
app.use((req, res, next) => {
	if (typeof req.csrfToken === 'function') {
		res.locals.csrfToken = req.csrfToken();
	}
	next();
});

// =====================
// 공통 locals
// =====================
app.use((req, res, next) => {
	res.locals.currentPath = req.path;
	res.locals.currentUrl = req.originalUrl;
	res.locals.user = req.session?.user || null;
	next();
});

// 장바구니 배지 계산(공통)
app.use(async (req, res, next) => {
	try {
		res.locals.cartCount = 0;

		if (req.session?.user) {
			const cartId = await ensureUserCartId(req.session.user.id);
			const [rows] = await db.execute('SELECT COALESCE(SUM(quantity),0) AS cnt FROM cart_items WHERE cart_id = ?', [cartId]);
			res.locals.cartCount = Number(rows[0]?.cnt || 0);
			return next();
		}

		const items = getGuestCart(req).items || {};
		res.locals.cartCount = Object.values(items).reduce((s, v) => s + (Number(v) || 0), 0);
		return next();
	} catch (err) {
		console.error('[cartCount]', err);
		return next();
	}
});

// =====================
// View engine
// =====================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// =====================
// Routes
// =====================
app.use('/', companyRouter);
app.use('/auth', authRouter);
app.use('/shop', shopRouter);
app.use('/admin', adminRouter);

// (선택) API 라우팅 - 사용 중이면 유지
app.use('/api', require('./routes/api'));

// =====================
// Error Handlers (순서 중요)
// =====================

// ✅ CSRF 에러는 500보다 먼저 처리해야 함
app.use((err, req, res, next) => {
	if (err && err.code === 'EBADCSRFTOKEN') {
		// 필요하면 디버그
		console.error('[CSRF]', {
			path: req.originalUrl,
			method: req.method,
			hasCookie: Boolean(req.headers.cookie),
			hasSession: Boolean(req.session),
			hasCsrfField: Boolean(req.body && req.body._csrf),
		});

		return res.status(403).send('CSRF 토큰이 유효하지 않습니다. 새로고침 후 다시 시도해주세요.');
	}
	next(err);
});

// 404
app.use((req, res) => {
	res.status(404).render('404', {
		message: '페이지를 찾을 수 없습니다.',
		currentPath: req.path,
		currentUrl: req.originalUrl,
		user: req.session?.user || null,
	});
});

// 500 (맨 마지막)
app.use((err, req, res, next) => {
	console.error('SERVER ERROR:', err);

	const errorId = `E-${Date.now()}`;
	if (res.headersSent) return next(err);

	res.status(500).render('500', {
		message: '서버 오류가 발생했습니다.',
		errorId,
		currentPath: req.path,
		currentUrl: req.originalUrl,
		user: req.session?.user || null,
	});
});

// =====================
// Start
// =====================
app.listen(PORT, () => {
	console.log(`Server running at http://127.0.0.1:${PORT}`);
});
