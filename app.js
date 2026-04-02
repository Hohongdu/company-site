// app.js
const path = require('path');

// ✅ dotenv: 실행 위치(CWD) 꼬임 방지 위해 절대경로로 로드
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const crypto = require('crypto');
const csurf = require('./lib/csurf');

const db = require('./db');
const { ensureUserCartId, getGuestCart } = require('./lib/cart');

const companyRouter = require('./routes/company');
const authRouter = require('./routes/auth');
const shopRouter = require('./routes/shop');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL;




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
// [M-5] SESSION_SECRET 미설정 시: 운영 환경에서는 서버 시작 자체를 거부
// 알려진 시크릿('change_me_in_env')으로 세션에 서명하면 공격자가 세션 토큰 위조 가능
if (!process.env.SESSION_SECRET) {
	if (process.env.NODE_ENV === 'production') {
		throw new Error('[FATAL] SESSION_SECRET must be set in .env for production. Refusing to start.');
	}
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

// 공통 CSRF 토큰 생성 (공개 페이지의 로그인 모달에서도 사용)
app.use((req, res, next) => {
	if (req.session && !req.session.csrfToken) {
		req.session.csrfToken = crypto.randomBytes(16).toString('hex');
	}
	if (req.session?.csrfToken) {
		res.locals.csrfToken = req.session.csrfToken;
	}
	next();
});

app.use('/auth', csrfProtection);
// [C-4] 멀티파트 우회 제거: 모든 /admin 요청에 CSRF 적용.
// multipart 폼은 form action에 ?_csrf=TOKEN 쿼리로 토큰 전달 (lib/csurf.js가 req.query._csrf 지원).
app.use('/admin', csrfProtection);
// [C-4] Shop 결제/장바구니/리뷰/위시리스트/문의 POST 라우트 CSRF 보호
app.use('/shop', csrfProtection);

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
		console.error('[CSRF]', {
			path: req.originalUrl,
			method: req.method,
			hasCookie: Boolean(req.headers.cookie),
			hasSession: Boolean(req.session),
			hasCsrfField: Boolean(req.body && req.body._csrf),
		});

		// 로그인 폼 전송 시 세션 만료/쿠키 없음 → 로그인 페이지로 리다이렉트
		if (req.originalUrl.startsWith('/auth/login')) {
			return res.redirect('/auth/login?csrf=1');
		}
		return res.status(403).render('403', {
			message: 'CSRF 토큰이 유효하지 않습니다. 페이지를 새로고침 후 다시 시도해주세요.',
		});
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
