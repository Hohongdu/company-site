// app.js
const path = require('path');

// ✅ dotenv: 실행 위치(CWD) 꼬임 방지 위해 절대경로로 로드
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const csurf = require('./lib/csurf');

const db = require('./db');
const { ensureUserCartId, getGuestCart } = require('./lib/cart');
const { ensureAdminActivityLogTable } = require('./services/audit.service');

const companyRouter = require('./routes/company');
const authRouter = require('./routes/auth');
const shopRouter = require('./routes/shop');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const LISTEN_HOST = process.env.LISTEN_HOST || undefined;
const BASE_URL = process.env.BASE_URL;

// /api/* 공통 limiter: 15분/100회
const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 100,
	standardHeaders: 'draft-7',
	legacyHeaders: false,
	handler: (req, res) => {
		res.status(429).json({ success: false, message: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' });
	},
});

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
// 요청 로거 (morgan 미설치 → 커스텀 미들웨어)
// 정적 파일(.css/.js/.ico/.png/.webp/.woff 등)은 로그에서 제외
// =====================
const STATIC_EXT_RE = /\.(css|js|ico|png|jpg|jpeg|webp|gif|svg|woff|woff2|ttf|eot|map)(\?.*)?$/i;

app.use((req, res, next) => {
	if (STATIC_EXT_RE.test(req.path)) return next();

	const start = Date.now();
	res.on('finish', () => {
		const duration = Date.now() - start;
		const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '-';
		const user = req.session?.user ? `[uid:${req.session.user.id}]` : '-';

		if (process.env.NODE_ENV === 'production') {
			// 운영: combined 스타일
			console.log(`[HTTP] ${new Date().toISOString()} ${ip} ${user} "${req.method} ${req.originalUrl}" ${res.statusCode} ${duration}ms`);
		} else {
			// 개발: 간결한 dev 스타일
			const colorCode = res.statusCode >= 500 ? '\x1b[31m' : res.statusCode >= 400 ? '\x1b[33m' : '\x1b[32m';
			console.log(`${colorCode}${req.method}\x1b[0m ${req.originalUrl} \x1b[90m${res.statusCode} ${duration}ms\x1b[0m`);
		}
	});
	next();
});

// =====================
// 세션
// =====================
// [M-5] SESSION_SECRET 미설정 시: 운영 환경에서는 서버 시작 자체를 거부
if (!process.env.SESSION_SECRET) {
	if (process.env.NODE_ENV === 'production') {
		throw new Error('[FATAL] SESSION_SECRET must be set in .env for production. Refusing to start.');
	}
	console.warn('[WARN] SESSION_SECRET is empty. Set it in .env for production safety.');
}

// [HIGH-3] FILE_TRANSFER_TOKEN_SECRET 미설정 시 경고 — 기본값은 공개된 문자열이므로 위조 토큰 가능
if (!process.env.FILE_TRANSFER_TOKEN_SECRET) {
	if (process.env.NODE_ENV === 'production') {
		throw new Error('[FATAL] FILE_TRANSFER_TOKEN_SECRET must be set in .env for production. Refusing to start.');
	}
	console.warn('[WARN] FILE_TRANSFER_TOKEN_SECRET not set. Using insecure default — must be set in .env!');
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
// 회사 정보 locals — CSRF보다 먼저 주입해야 에러 페이지에서도 사용 가능
// .env의 COMPANY_* 변수로 오버라이드 가능 (하드코딩 제거)
// 전자상거래법 시행령 제10조: 사업자 정보 표시 의무 항목 (CEO, bizNo, mailOrderNo)
// =====================
const COMPANY_INFO = {
	name:    process.env.COMPANY_NAME    || 'ENERMADE',
	ceo:     process.env.COMPANY_CEO     || '',
	phone:   process.env.COMPANY_PHONE   || '02-0000-0000',
	address: process.env.COMPANY_ADDRESS || '서울특별시 강남구 테헤란로 123',
	email:   process.env.COMPANY_EMAIL   || 'contact@enermade.com',
	fax:     process.env.COMPANY_FAX     || '',
	bizNo:        process.env.COMPANY_BIZ_NO         || '',
	mailOrderNo:  process.env.COMPANY_MAIL_ORDER_NO  || '',
	privacyOfficer: {
		name:  process.env.COMPANY_PRIVACY_OFFICER_NAME  || '',
		email: process.env.COMPANY_PRIVACY_OFFICER_EMAIL || '',
	},
};

// 법적 문서 시행일 (약관/개인정보처리방침)
const LEGAL_INFO = {
	termsEffectiveDate:   process.env.LEGAL_TERMS_EFFECTIVE_DATE   || '2026-01-01',
	privacyEffectiveDate: process.env.LEGAL_PRIVACY_EFFECTIVE_DATE || '2026-01-01',
};

// =====================
// 공통 locals (CSRF 이전 — 에러 핸들러에서도 res.locals.company 보장)
// =====================
app.use((req, res, next) => {
	res.locals.currentPath = req.path;
	res.locals.currentUrl = req.originalUrl;
	res.locals.user = req.session?.user || null;
	res.locals.company = COMPANY_INFO;
	res.locals.legal = LEGAL_INFO;
	next();
});

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
// multipart/form-data 요청은 express body-parser가 req.body를 채우지 않으므로
// 전역 CSRF 체크 시점에 req.body._csrf가 비어있다.
// 대신 각 multipart 라우트 핸들러에서 multer 이후 csrfProtection을 명시적으로 적용한다.
// (routes/admin.js: router.post('/products/new', uploadImage.single(...), csrfProtection, ...))
// 새 multipart 라우트 추가 시 반드시 핸들러 인자에 csrfProtection을 포함할 것.
app.use('/admin', (req, res, next) => {
	if (req.method === 'GET' || !req.is('multipart/form-data')) {
		return csrfProtection(req, res, next);
	}
	return next();
});
// [C-4] Shop 결제/장바구니/리뷰/위시리스트/문의 POST 라우트 CSRF 보호
app.use('/shop', csrfProtection);

// EJS에서 csrfToken 바로 사용 가능하게 주입
app.use((req, res, next) => {
	if (typeof req.csrfToken === 'function') {
		res.locals.csrfToken = req.csrfToken();
	}
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

// API 라우팅: 공통 limiter 적용
app.use('/api', apiLimiter, require('./routes/api'));

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
const { sendAdminErrorAlert } = require('./services/smtp-email.service');

app.use(async (err, req, res, next) => {
	const status = err.status || err.statusCode || 500;
	console.error(`[${status}] ${req.method} ${req.originalUrl}`, err);

	if (res.headersSent) return next(err);

	// 관리자 알림 이메일 (비차단)
	sendAdminErrorAlert({
		error: err.message || String(err),
		url: req.originalUrl,
		method: req.method,
		userId: req.session?.user?.id,
		stack: err.stack,
	}).catch(() => {});

	if (req.xhr || req.headers.accept?.includes('application/json')) {
		return res.status(status).json({ ok: false, message: '서버 오류가 발생했습니다.' });
	}

	const errorId = `E-${Date.now()}`;
	return res.status(status).render('error', {
		statusCode: status,
		message: '서버 오류가 발생했습니다.',
		backHref: req.get('referer') || '/',
		errorId,
		currentPath: req.path,
		currentUrl: req.originalUrl,
		user: req.session?.user || null,
	});
});

// =====================
// Start
// =====================

// [CODEX-1] 서버 시작 전 DB 연결 검증 — 설정 오류를 첫 요청이 아닌 시작 시점에 감지
async function initializeSchemas() {
	// 감사 로그 테이블 초기화 (audit.service.js)
	await ensureAdminActivityLogTable();
	// authRouter 포함 — 회원가입 동의 컬럼 자동 마이그레이션
	for (const router of [companyRouter, authRouter, shopRouter, adminRouter]) {
		if (typeof router.initializeSchema === 'function') {
			await router.initializeSchema();
		}
	}
}

(async () => {
	try {
		await db.execute('SELECT 1');
		console.log('[DB] 데이터베이스 연결 확인 완료');
		await initializeSchemas();
	} catch (err) {
		console.error('[FATAL] 데이터베이스 연결 실패 — 서버 시작 중단:', err.message);
		process.exit(1);
	}

	app.listen(PORT, LISTEN_HOST, () => {
		console.log(`Server running at http://${LISTEN_HOST || '127.0.0.1'}:${PORT}`);
	});
})();
