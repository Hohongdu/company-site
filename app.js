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
const { requireLogin } = require('./middleware/auth');

const companyRouter = require('./routes/company');
const authRouter = require('./routes/auth');
const shopRouter = require('./routes/shop/index');
const adminRouter = require('./routes/admin/index');

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
// [C-1 수정] multipart 업로드 라우트(상품 이미지)는 multer 이후 라우트 레벨에서 CSRF를 개별 적용.
// 그 외 모든 admin 경로는 글로벌에서도 CSRF 검증. 이중 방어로 우회 불가.
app.use('/admin', (req, res, next) => {
	// multipart는 글로벌에서 우회(multer 미실행 시 req.body 미파싱) — 각 라우트에서 개별 보호
	if (req.is('multipart/form-data')) return next();
	return csrfProtection(req, res, next);
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

		return res.status(403).render('403', {
			message: 'CSRF 토큰이 유효하지 않습니다. 새로고침 후 다시 시도해주세요.',
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

// 429 / general errors (맨 마지막)
app.use((err, req, res, next) => {
	if (res.headersSent) return next(err);

	// Rate limit errors
	if (err.status === 429 || err.statusCode === 429) {
		return res.status(429).render('500', {
			message: '너무 많은 요청입니다. 잠시 후 다시 시도해주세요.',
			errorId: null,
			currentPath: req.path,
			currentUrl: req.originalUrl,
			user: req.session?.user || null,
		});
	}

	console.error('[server error]', err);

	const status = err.status || err.statusCode || 500;
	const errorId = `E-${Date.now()}`;
	const message = status < 500 ? err.message : '서버 오류가 발생했습니다.';

	res.status(status).render('500', {
		message,
		errorId,
		currentPath: req.path,
		currentUrl: req.originalUrl,
		user: req.session?.user || null,
	});
});

// =====================
// DB 스키마 자동 보정 (누락된 컬럼/테이블 안전하게 추가)
// =====================
async function runSchemaMigrations() {
	const safeAlter = async (sql) => {
		try {
			await db.execute(sql);
		} catch (err) {
			// "Duplicate column" 오류는 이미 존재하므로 무시
			if (!String(err?.message || '').toLowerCase().includes('duplicate column')) {
				console.warn('[migration] 스키마 보정 오류 (무시됨):', err.message);
			}
		}
	};

	try {
		// orders 테이블 컬럼 보정
		await safeAlter(`CREATE TABLE IF NOT EXISTS orders (
			id BIGINT AUTO_INCREMENT PRIMARY KEY,
			order_number VARCHAR(32) NOT NULL DEFAULT '',
			user_id BIGINT NULL,
			guest_name VARCHAR(100) NULL,
			guest_email VARCHAR(150) NULL,
			guest_phone VARCHAR(30) NULL,
			status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
			total_amount INT NOT NULL DEFAULT 0,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
		)`);
		await safeAlter(`ALTER TABLE orders ADD COLUMN order_number VARCHAR(32) NOT NULL DEFAULT ''`);
		await safeAlter(`ALTER TABLE orders ADD COLUMN total_amount INT NOT NULL DEFAULT 0`);
		await safeAlter(`ALTER TABLE orders ADD COLUMN guest_name VARCHAR(100) NULL`);
		await safeAlter(`ALTER TABLE orders ADD COLUMN guest_email VARCHAR(150) NULL`);
		await safeAlter(`ALTER TABLE orders ADD COLUMN guest_phone VARCHAR(30) NULL`);
		await safeAlter(`ALTER TABLE orders ADD COLUMN delivery_status VARCHAR(30) DEFAULT 'READY'`);
		await safeAlter(`ALTER TABLE orders ADD COLUMN tracking_number VARCHAR(100) NULL`);
		await safeAlter(`ALTER TABLE orders ADD COLUMN shipping_name VARCHAR(100) NULL`);
		await safeAlter(`ALTER TABLE orders ADD COLUMN shipping_phone VARCHAR(30) NULL`);
		await safeAlter(`ALTER TABLE orders ADD COLUMN shipping_address VARCHAR(255) NULL`);
		await safeAlter(`ALTER TABLE orders ADD COLUMN discount_amount INT NOT NULL DEFAULT 0`);
		await safeAlter(`ALTER TABLE orders ADD COLUMN coupon_code VARCHAR(50) NULL`);

		// order_payments 테이블 생성
		await safeAlter(`CREATE TABLE IF NOT EXISTS order_payments (
			id BIGINT AUTO_INCREMENT PRIMARY KEY,
			order_id BIGINT NOT NULL,
			provider VARCHAR(30) NOT NULL,
			tid VARCHAR(100) NULL,
			status VARCHAR(30) NOT NULL DEFAULT 'READY',
			amount INT NOT NULL DEFAULT 0,
			requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			approved_at DATETIME NULL
		)`);

		// inquiries 테이블 컬럼 보정
		await safeAlter(`CREATE TABLE IF NOT EXISTS inquiries (
			id BIGINT AUTO_INCREMENT PRIMARY KEY,
			order_id BIGINT NULL,
			user_id BIGINT NULL,
			guest_name VARCHAR(100) NULL,
			guest_email VARCHAR(150) NULL,
			guest_phone VARCHAR(30) NULL,
			title VARCHAR(200) NOT NULL DEFAULT '',
			content TEXT NOT NULL,
			status VARCHAR(30) NOT NULL DEFAULT 'NEW',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
		)`);
		await safeAlter(`ALTER TABLE inquiries ADD COLUMN answer_content TEXT NULL`);
		await safeAlter(`ALTER TABLE inquiries ADD COLUMN answered_at DATETIME NULL`);
		await safeAlter(`ALTER TABLE inquiries ADD COLUMN notification_channel VARCHAR(20) NULL`);
		await safeAlter(`ALTER TABLE inquiries ADD COLUMN notification_status VARCHAR(20) NULL`);
		await safeAlter(`ALTER TABLE inquiries ADD COLUMN notification_error TEXT NULL`);

		// products 테이블 컬럼 보정
		await safeAlter(`ALTER TABLE products ADD COLUMN stock_quantity INT DEFAULT 0`);
		await safeAlter(`ALTER TABLE products ADD COLUMN visibility_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'`);

		// notices 테이블
		await safeAlter(`CREATE TABLE IF NOT EXISTS notices (
			id INT AUTO_INCREMENT PRIMARY KEY,
			title VARCHAR(200) NOT NULL,
			content TEXT NOT NULL,
			category VARCHAR(30) NOT NULL DEFAULT 'general',
			views INT NOT NULL DEFAULT 0,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`);
		await safeAlter(`ALTER TABLE notices ADD COLUMN category VARCHAR(30) NOT NULL DEFAULT 'general'`);

		console.log('[migration] 스키마 보정 완료');
	} catch (err) {
		// H-8: 마이그레이션 실패 시 서버 기동 중단
		console.error('[migration] 치명적 오류 — 서버를 시작하지 않습니다:', err);
		throw err;
	}
}

// =====================
// Start
// =====================
runSchemaMigrations()
	.then(() => {
		app.listen(PORT, () => {
			console.log(`Server running at http://127.0.0.1:${PORT}`);
		});
	})
	.catch((err) => {
		console.error('[startup] 마이그레이션 실패로 프로세스를 종료합니다:', err.message);
		process.exit(1);
	});
