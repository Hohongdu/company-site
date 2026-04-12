// routes/admin.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const xlsx = require('xlsx');
const fs = require('fs/promises');
const fssync = require('fs');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { sendInquiryReplyEmail } = require('../services/notification.service');
const { sendMail, isConfigured: isEmailConfigured, getDriverName } = require('../services/email.service');
const searchLogService = require('../services/search-log.service');
const { logAdminAction } = require('../services/audit.service');
let sharp = null;
try {
	sharp = require('sharp');
} catch (err) {
	console.warn('[admin] sharp 모듈이 없어 이미지 최적화 기능이 비활성화됩니다.');
}
const os = require('os');
const { exec } = require('child_process');
const csurf = require('../lib/csurf');

const router = express.Router();
const csrfProtection = csurf({ ignoreMethods: ['GET', 'HEAD', 'OPTIONS'] });

function renderRouteError(req, res, statusCode, message, backHref = req.get('referer') || '/admin') {
	return res.status(statusCode).render('error', {
		statusCode,
		message,
		backHref,
	});
}

async function markUploadFailed(uploadId) {
	if (!uploadId) return;
	await db.execute(`UPDATE upload_histories SET status='FAILED' WHERE id=?`, [uploadId]).catch(() => {});
}

/* =========================
   유틸
========================= */
function pct(part, total) {
	if (!total) return 0;
	return Math.round((part / total) * 100);
}

function healthLabel(level) {
	if (level === 'good') return { text: '좋음', badge: 'success' };
	if (level === 'warn') return { text: '주의', badge: 'warning' };
	return { text: '위험', badge: 'danger' };
}

function loadHealth(load1, cpuCores) {
	// 코어 대비 0.7 미만 = good, 0.7~1.0 = warn, 1.0 이상 = bad
	const ratio = cpuCores ? load1 / cpuCores : load1;
	if (ratio < 0.7) return { level: 'good', ratio };
	if (ratio < 1.0) return { level: 'warn', ratio };
	return { level: 'bad', ratio };
}

function diskHealth(usedPct) {
	if (usedPct < 70) return 'good';
	if (usedPct < 85) return 'warn';
	return 'bad';
}

function execAsync(cmd) {
	return new Promise((resolve) => {
		exec(cmd, (err, stdout) => {
			if (err) return resolve('');
			resolve(String(stdout || '').trim());
		});
	});
}

async function ensureNoticesTable() {
	await db.execute(
		`CREATE TABLE IF NOT EXISTS notices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      content TEXT NOT NULL,
      category VARCHAR(30) NOT NULL DEFAULT 'general',
      views INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
	);
}

async function ensureNoticeCategoryColumn() {
	try {
		await db.execute(`ALTER TABLE notices ADD COLUMN category VARCHAR(30) NOT NULL DEFAULT 'general'`);
	} catch (err) {
		if (!String(err?.message || '').includes('Duplicate column')) throw err;
	}
}

async function ensureProductStockColumn() {
	try {
		await db.execute(`ALTER TABLE products ADD COLUMN stock_quantity INT DEFAULT 0`);
	} catch (err) {
		if (!String(err?.message || '').includes('Duplicate column')) throw err;
	}
}

async function ensureProductVisibilityColumn() {
	try {
		await db.execute(`ALTER TABLE products ADD COLUMN visibility_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'`);
	} catch (err) {
		if (!String(err?.message || '').includes('Duplicate column')) throw err;
	}
}

// logAdminAction은 services/audit.service.js에서 import (인라인 구현 제거)

async function ensureOrderShippingColumns() {
	try {
		await db.execute(`ALTER TABLE orders ADD COLUMN delivery_status VARCHAR(30) DEFAULT 'READY'`);
	} catch (err) {
		if (!String(err?.message || '').includes('Duplicate column')) throw err;
	}
	try {
		await db.execute(`ALTER TABLE orders ADD COLUMN tracking_number VARCHAR(100)`);
	} catch (err) {
		if (!String(err?.message || '').includes('Duplicate column')) throw err;
	}
}

router.initializeSchema = async function initializeSchema() {
	await ensureNoticesTable();
	await ensureNoticeCategoryColumn();
	await ensureProductStockColumn();
	await ensureProductVisibilityColumn();
	// admin_activity_logs 테이블은 services/audit.service.js에서 초기화 (app.js에서 호출)
	await ensureOrderShippingColumns();
};

/* =========================
   업로드/이미지 설정
========================= */
// [H-4] Excel 업로드 제한: 파일 타입 및 크기 검증 추가
// 관리자 세션이 탈취되더라도 임의 파일 업로드/디스크 고갈 방지
const upload = multer({
	dest: 'uploads/',
	limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
	fileFilter: (req, file, cb) => {
		const allowedMimes = [
			'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
			'application/vnd.ms-excel', // .xls
		];
		if (allowedMimes.includes(file.mimetype)) {
			cb(null, true);
		} else {
			cb(new Error('Excel 파일(.xlsx, .xls)만 업로드 가능합니다.'), false);
		}
	},
});



// tmp / public/uploads 폴더 보장
const tmpDir = path.join(__dirname, '..', 'tmp');
const publicUploadsDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fssync.existsSync(tmpDir)) fssync.mkdirSync(tmpDir, { recursive: true });
if (!fssync.existsSync(publicUploadsDir)) fssync.mkdirSync(publicUploadsDir, { recursive: true });

const storage = multer.diskStorage({
	destination: (req, file, cb) => cb(null, tmpDir),
	filename: (req, file, cb) => {
		const ext = path.extname(file.originalname).toLowerCase();
		cb(null, `p_${Date.now()}${ext}`);
	},
});

const fileFilter = (req, file, cb) => {
	const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
	cb(ok ? null : new Error('이미지 파일만 업로드 가능합니다.'), ok);
};

const uploadImage = multer({
	storage,
	fileFilter,
	limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

async function processImageToWebp(reqFilePath) {
	const ext = path.extname(reqFilePath).toLowerCase() || '.jpg';
	const base = `p_${Date.now()}`;

	if (!sharp) {
		const fallbackName = `${base}${ext}`;
		const fallbackPath = path.join(publicUploadsDir, fallbackName);
		await fs.copyFile(reqFilePath, fallbackPath);
		return {
			image: `/uploads/${fallbackName}`,
			image_thumb: `/uploads/${fallbackName}`,
		};
	}

	const fileName = `${base}.webp`;
	const thumbName = `${base}_thumb.webp`;

	const outFull = path.join(publicUploadsDir, fileName);
	const outThumb = path.join(publicUploadsDir, thumbName);

	// 원본(상세용): 최대 1200px
	await sharp(reqFilePath).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 75 }).toFile(outFull);

	// 썸네일(목록용): 320px
	await sharp(reqFilePath).resize({ width: 320, withoutEnlargement: true }).webp({ quality: 70 }).toFile(outThumb);

	return {
		image: `/uploads/${fileName}`,
		image_thumb: `/uploads/${thumbName}`,
	};
}

/* =========================
   공통: 관리자만 접근
========================= */
router.use(requireAdmin);

/* =========================
   관리자 메인 → 대시보드
========================= */
router.get('/', (req, res) => res.redirect('/admin/dashboard'));

router.get('/dashboard', async (req, res) => {
	try {
		const [[productCnt]] = await db.execute('SELECT COUNT(*) AS cnt FROM products');
		const [[categoryCnt]] = await db.execute('SELECT COUNT(*) AS cnt FROM categories');
		const [[orderCnt]] = await db.execute('SELECT COUNT(*) AS cnt FROM orders');
		const [[inquiryCnt]] = await db.execute('SELECT COUNT(*) AS cnt FROM inquiries');

		const [recentOrders] = await db.execute(
			`SELECT o.order_number, o.status, o.total_amount, o.created_at,
        u.name AS user_name, o.guest_name
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       ORDER BY o.created_at DESC
       LIMIT 5`,
		);

		const [recentInquiries] = await db.execute(
			`SELECT i.title, i.status, i.created_at, o.order_number,
        u.name AS user_name, i.guest_name
       FROM inquiries i
       LEFT JOIN orders o ON o.id = i.order_id
       LEFT JOIN users u ON u.id = i.user_id
       ORDER BY i.created_at DESC
       LIMIT 5`,
		);

		const [monthlyOrders] = await db.execute(
			`SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym,
        COUNT(*) AS cnt,
        COALESCE(SUM(total_amount), 0) AS revenue
       FROM orders
       WHERE created_at >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-01')
       GROUP BY ym
       ORDER BY ym ASC`,
		);

		const [monthlyInquiries] = await db.execute(
			`SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym,
        COUNT(*) AS cnt
       FROM inquiries
       WHERE created_at >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-01')
       GROUP BY ym
       ORDER BY ym ASC`,
		);

		const monthLabels = [];
		const now = new Date();
		for (let i = 5; i >= 0; i -= 1) {
			const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
			const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
			monthLabels.push(ym);
		}

		const orderMap = new Map(monthlyOrders.map((row) => [row.ym, Number(row.cnt || 0)]));
		const revenueMap = new Map(monthlyOrders.map((row) => [row.ym, Number(row.revenue || 0)]));
		const inquiryMap = new Map(monthlyInquiries.map((row) => [row.ym, Number(row.cnt || 0)]));

		const chartData = {
			labels: monthLabels.map((ym) => ym.slice(5).replace('-', '/')),
			orders: monthLabels.map((ym) => orderMap.get(ym) || 0),
			inquiries: monthLabels.map((ym) => inquiryMap.get(ym) || 0),
			revenue: monthLabels.map((ym) => revenueMap.get(ym) || 0),
		};

		// --- 시스템 상태 ---
		const cpuCores = os.cpus().length;
		const load = os.loadavg(); // [1m,5m,15m]
		const totalMem = os.totalmem();
		const freeMem = os.freemem();
		const usedMem = totalMem - freeMem;

		const memUsedPct = pct(usedMem, totalMem);
		const loadInfo = loadHealth(load[0], cpuCores);

		// 플랫폼별(라즈베리파이/리눅스 vs 윈도우) 처리
		let diskTotal = 'N/A';
		let diskUsed = 'N/A';
		let diskAvail = 'N/A';
		let diskUsedPct = 0;

		let nginxHead = 'N/A';
		let vnstatDaily = 'N/A';
		let vnstatMonthly = 'N/A';

		if (process.platform !== 'win32') {
			// 디스크 사용량(루트)
			const dfLine = await execAsync(`df -h / | tail -n 1 | awk '{print $2,$3,$4,$5}'`);
			// 예: "29G 7.5G 20G 28%"
			const [t, u, a, pctRaw] = (dfLine || '').split(/\s+/);
			diskTotal = t || '';
			diskUsed = u || '';
			diskAvail = a || '';
			diskUsedPct = Number(String(pctRaw || '0').replace('%', '')) || 0;

			// nginx 응답 체크 (너가 8080 프록시로 쓰는 전제)
			nginxHead = await execAsync(`curl -I -s http://127.0.0.1:8080/ | head -n 1`);

			// vnstat (있으면)
			vnstatDaily = await execAsync(`vnstat -d 2>/dev/null | tail -n 1`);
			vnstatMonthly = await execAsync(`vnstat -m 2>/dev/null | tail -n 1`);
		}

		res.render('admin/dashboard', {
			stats: {
				totalProducts: productCnt.cnt,
				totalCategories: categoryCnt.cnt,
				totalOrders: orderCnt.cnt,
				totalInquiries: inquiryCnt.cnt,
			},
			sys: {
				load1: load[0],
				load5: load[1],
				load15: load[2],
				cpuCores,
				memTotalMB: Math.round(totalMem / 1024 / 1024),
				memUsedMB: Math.round(usedMem / 1024 / 1024),
				memFreeMB: Math.round(freeMem / 1024 / 1024),
				memUsedPct,

				diskTotal,
				diskUsed,
				diskAvail,
				diskUsedPct,

				nginxHead, // "HTTP/1.1 200 OK" or "N/A"
				vnstatDaily,
				vnstatMonthly,

				// 해석(비전공자용)
				cpuStatus: healthLabel(loadInfo.level),
				cpuRatioPct: Math.round(loadInfo.ratio * 100), // 코어 대비 %
				memStatus: healthLabel(memUsedPct < 70 ? 'good' : memUsedPct < 85 ? 'warn' : 'bad'),
				diskStatus: healthLabel(diskHealth(diskUsedPct)),
				nginxStatus: String(nginxHead || '').includes('200') ? healthLabel('good') : healthLabel('warn'),
			},
			recentOrders,
			recentInquiries,
			chartData,
		});
	} catch (err) {
		console.error(err);
		return renderRouteError(req, res, 500, '대시보드 로딩 오류');
	}
});

/* =========================
   공지 관리
========================= */
router.get('/notices', async (req, res) => {
	try {
		const [notices] = await db.execute(
			`SELECT id, title, category, created_at, views
       FROM notices
       ORDER BY created_at DESC`,
		);

		return res.render('admin/notices', { notices, csrfToken: req.csrfToken() });
	} catch (err) {
		console.error(err);
		return renderRouteError(req, res, 500, '공지 목록 로딩 오류');
	}
});

router.post('/notices', csrfProtection, async (req, res) => {
	try {
		const title = String(req.body.title || '').trim();
		const content = String(req.body.content || '').trim();
		const category = String(req.body.category || 'general').trim();
		const allowed = new Set(['general', 'product', 'event']);
		const safeCategory = allowed.has(category) ? category : 'general';

		if (!title || !content) {
			return renderRouteError(req, res, 400, '공지 제목과 내용을 입력해주세요.');
		}

		const [noticeInsert] = await db.execute(`INSERT INTO notices (title, content, category) VALUES (?, ?, ?)`, [
			title,
			content,
			safeCategory,
		]);

		await logAdminAction(req, 'notice_create', 'notice', noticeInsert.insertId, true, { title, category: safeCategory });

		return res.redirect('/admin/notices');
	} catch (err) {
		console.error(err);
		return renderRouteError(req, res, 500, '공지 등록 오류');
	}
});

router.post('/notices/:id/delete', csrfProtection, async (req, res) => {
	try {
		const noticeId = Number(req.params.id);
		if (!noticeId) return res.redirect('/admin/notices');

		await db.execute('DELETE FROM notices WHERE id = ?', [noticeId]);
		await logAdminAction(req, 'notice_delete', 'notice', noticeId, true, null);

		return res.redirect('/admin/notices');
	} catch (err) {
		console.error(err);
		return renderRouteError(req, res, 500, '공지 삭제 오류');
	}
});

/* =========================
   상품 목록
========================= */
router.get('/products', async (req, res) => {
	try {

		const categoryId = Number(req.query.category || 0) || null;
		const minPrice = Number(req.query.minPrice || 0) || null;
		const maxPrice = Number(req.query.maxPrice || 0) || null;
		const stockStatus = String(req.query.stockStatus || 'all');
		const visibility = String(req.query.visibility || 'all');

		const filters = [];
		const params = [];

		if (categoryId) {
			filters.push('p.category_id = ?');
			params.push(categoryId);
		}
		if (minPrice !== null) {
			filters.push('p.price >= ?');
			params.push(minPrice);
		}
		if (maxPrice !== null) {
			filters.push('p.price <= ?');
			params.push(maxPrice);
		}
		if (visibility !== 'all') {
			filters.push('p.visibility_status = ?');
			params.push(visibility);
		}
		if (stockStatus === 'out') {
			filters.push('COALESCE(p.stock_quantity, 0) <= 0');
		} else if (stockStatus === 'low') {
			filters.push('COALESCE(p.stock_quantity, 0) BETWEEN 1 AND 5');
		} else if (stockStatus === 'in') {
			filters.push('COALESCE(p.stock_quantity, 0) > 5');
		}

		const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
		const [products] = await db.execute(
			`
			SELECT p.*, c.name AS category_name
			FROM products p
			LEFT JOIN categories c ON c.id = p.category_id
			${whereClause}
			ORDER BY p.id DESC
		`,
			params,
		);
		const [categories] = await db.execute('SELECT id, name FROM categories ORDER BY name');

		const notice = req.query.notice ? String(req.query.notice) : '';
		const error = req.query.error ? String(req.query.error) : '';

		res.render('admin/products', {
			products,
			categories,
			csrfToken: req.csrfToken(),
			filters: { categoryId, minPrice, maxPrice, stockStatus, visibility },
			notice,
			error,
		});
	} catch (err) {
		console.error(err);
		return renderRouteError(req, res, 500, '상품 목록 로딩 오류');
	}
});

/* =========================
   상품 등록
========================= */
router.get('/products/new', async (req, res) => {
	try {
		const [categories] = await db.execute('SELECT id, name FROM categories ORDER BY name');
		res.render('admin/admin-product-new', {
			categories,
			csrfToken: req.csrfToken(),
		});
	} catch (err) {
		console.error(err);
		return renderRouteError(req, res, 500, '상품 등록 페이지 로딩 오류');
	}
});

// [C-4] app.js에서 app.use('/admin', csrfProtection)로 통합됨 → 라우트 레벨 중복 제거
router.post('/products/new', uploadImage.single('imageFile'), async (req, res) => {
	try {
		const { code, name, description, price, spec, category_id, image, stock_quantity } = req.body;

		let imagePath = image || null;
		let thumbPath = null;

		if (req.file) {
			const processed = await processImageToWebp(req.file.path);
			// multer 임시파일 삭제
			await fs.unlink(req.file.path).catch(() => {});
			imagePath = processed.image;
			thumbPath = processed.image_thumb;
		}

		const [insertResult] = await db.execute(
			`INSERT INTO products (code, name, description, price, spec, image, image_thumb, category_id, stock_quantity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				code || null,
				name,
				description || null,
				Number(price) || 0,
				spec || null,
				imagePath,
				thumbPath,
				category_id || null,
				Number(stock_quantity) || 0,
			],
		);

		await logAdminAction(req, 'product_create', 'product', insertResult.insertId, true, {
			code: code || null,
			name,
		});

		return res.redirect('/admin/products');
	} catch (err) {
		console.error(err);
		return renderRouteError(req, res, 500, '상품 등록 오류');
	}
});

/* =========================
   상품 수정
========================= */
router.get('/products/:id/edit', async (req, res) => {
	try {
		const productId = Number(req.params.id);

		const [[product]] = await db.execute('SELECT * FROM products WHERE id = ?', [productId]);
		const [categories] = await db.execute('SELECT id, name FROM categories ORDER BY name');

		if (!product) return renderRouteError(req, res, 404, '상품 없음');

		res.render('admin/admin-product-edit', {
			product,
			categories,
			csrfToken: req.csrfToken(),
		});
	} catch (err) {
		console.error(err);
		return renderRouteError(req, res, 500, '상품 수정 페이지 로딩 오류');
	}
});

// [C-4] 라우트 레벨 중복 csrfProtection 제거 (app.js에서 통합)
router.post('/products/:id/edit', uploadImage.single('imageFile'), async (req, res) => {
	try {
		const productId = Number(req.params.id);
		const { code, name, description, price, spec, category_id, image, stock_quantity } = req.body;

		// 기존 이미지 유지용 조회
		const [rows] = await db.execute('SELECT image, image_thumb FROM products WHERE id = ? LIMIT 1', [productId]);
		if (!rows.length) return renderRouteError(req, res, 404, '상품 없음');

		let imagePath = rows[0].image || null;
		let thumbPath = rows[0].image_thumb || null;

		// 새 파일 업로드가 있으면 교체
		if (req.file) {
			const processed = await processImageToWebp(req.file.path);
			await fs.unlink(req.file.path).catch(() => {});
			imagePath = processed.image;
			thumbPath = processed.image_thumb;
		} else {
			// 파일 없고 URL 입력(image)이 있으면 그걸로 교체 (thumb는 null)
			if (image && String(image).trim()) {
				imagePath = String(image).trim();
				thumbPath = null;
			}
		}

		const [updateResult] = await db.execute(
			`UPDATE products
       SET code=?, name=?, description=?, price=?, spec=?, image=?, image_thumb=?, category_id=?, stock_quantity=?
       WHERE id=?`,
			[
				code || null,
				name,
				description || null,
				Number(price) || 0,
				spec || null,
				imagePath,
				thumbPath,
				category_id || null,
				Number(stock_quantity) || 0,
				productId,
			],
		);

		if (updateResult.affectedRows > 0) {
			await logAdminAction(req, 'product_update', 'product', productId, true, {
				code: code || null,
				name,
			});
		}

		return res.redirect('/admin/products');
	} catch (err) {
		console.error(err);
		return renderRouteError(req, res, 500, '상품 수정 오류');
	}
});

/* =========================
   상품 삭제 (장바구니 정리 포함)
========================= */
router.post('/products/:id/delete', async (req, res) => {
	try {
		const productId = Number(req.params.id);

		await db.execute('DELETE FROM cart_items WHERE product_id = ?', [productId]);
		await db.execute('DELETE FROM products WHERE id = ?', [productId]);
		await logAdminAction(req, 'product_delete', 'product', productId, true, null);

		res.redirect('/admin/products?notice=' + encodeURIComponent('상품이 삭제되었습니다.'));
	} catch (err) {
		console.error(err);
		return renderRouteError(req, res, 500, '상품 삭제 오류');
	}
});

/* =========================
   상품 상태 변경
========================= */
router.post('/products/:id/status', csrfProtection, async (req, res) => {
	try {
		const productId = Number(req.params.id);
		const status = String(req.body.visibility_status || '').toUpperCase();
		if (!productId) {
			return res.redirect('/admin/products?error=' + encodeURIComponent('상품 정보가 올바르지 않습니다.'));
		}

		const nextStatus = status === 'HIDDEN' ? 'HIDDEN' : 'ACTIVE';
		await db.execute('UPDATE products SET visibility_status = ? WHERE id = ?', [nextStatus, productId]);
		await logAdminAction(req, 'product_visibility_update', 'product', productId, true, { visibility_status: nextStatus });

		return res.redirect('/admin/products?notice=' + encodeURIComponent('노출 상태가 변경되었습니다.'));
	} catch (err) {
		console.error(err);
		return renderRouteError(req, res, 500, '상품 상태 변경 오류');
	}
});

/* =========================
   재고 변경
========================= */
router.post('/products/:id/stock', csrfProtection, async (req, res) => {
	try {
		const productId = Number(req.params.id);
		const stockQty = Number(req.body.stock_quantity);
		if (!productId || !Number.isFinite(stockQty) || stockQty < 0) {
			return res.redirect('/admin/products?error=' + encodeURIComponent('재고 수량이 올바르지 않습니다.'));
		}

		await db.execute('UPDATE products SET stock_quantity = ? WHERE id = ?', [stockQty, productId]);
		await logAdminAction(req, 'product_stock_update', 'product', productId, true, { stock_quantity: stockQty });

		return res.redirect('/admin/products?notice=' + encodeURIComponent('재고 수량이 저장되었습니다.'));
	} catch (err) {
		console.error(err);
		return renderRouteError(req, res, 500, '재고 변경 오류');
	}
});

/* =========================
   상품 상태 변경
   상품 선택 삭제 (장바구니 정리 포함)
========================= */
router.post('/products/bulk-delete', csrfProtection, async (req, res) => {
	try {
		const productIds = []
			.concat(req.body.productIds || [])
			.map((id) => Number(id))
			.filter((id) => Number.isFinite(id) && id > 0);

		if (!productIds.length) {
			return res.redirect('/admin/products?error=' + encodeURIComponent('삭제할 상품을 선택해주세요.'));
		}

		const placeholders = productIds.map(() => '?').join(',');
		await db.execute(`DELETE FROM cart_items WHERE product_id IN (${placeholders})`, productIds);
		await db.execute(`DELETE FROM products WHERE id IN (${placeholders})`, productIds);
		await logAdminAction(req, 'product_bulk_delete', 'product', null, true, { productIds, count: productIds.length });

		return res.redirect('/admin/products?notice=' + encodeURIComponent(`선택한 상품 ${productIds.length}개가 삭제되었습니다.`));
	} catch (err) {
		console.error(err);
		return renderRouteError(req, res, 500, '상품 선택 삭제 오류');
	}
});

/* =========================
   엑셀 업로드
========================= */
router.get('/products/import', csrfProtection, async (req, res) => {
	try {
		const [uploads] = await db.execute(`
      SELECT id, original_name, stored_name, status, success_count, fail_count, created_at
      FROM upload_histories
      ORDER BY id DESC
      LIMIT 30
    `);

		const flash =
			req.query && req.query.ok
				? {
						ok: req.query.ok === '1',
						success: Number(req.query.success || 0),
						fail: Number(req.query.fail || 0),
						uploadId: req.query.uploadId ? Number(req.query.uploadId) : null,
					}
				: null;

		return res.render('admin/admin-product-import', {
			uploads,
			csrfToken: req.csrfToken(),
			flash,
		});
	} catch (err) {
		console.error(err);
		return res.render('admin/admin-product-import', {
			uploads: [],
			csrfToken: req.csrfToken(),
			flash: null,
		});
	}
});

// [C-4] 라우트 레벨 중복 csrfProtection 제거 (app.js에서 통합; 토큰은 ?_csrf 쿼리로 전달)
router.post('/products/import', upload.single('file'), async (req, res) => {
	let uploadId = null;

	try {
		if (!req.file) return renderRouteError(req, res, 400, '업로드 파일이 필요합니다.');

		// 1) upload_histories 기록 생성 (PROCESSING)
		const originalName = req.file.originalname || null;
		const storedName = req.file.filename || req.file.path || null;

		const [ins] = await db.execute(
			`INSERT INTO upload_histories (original_name, stored_name, status, success_count, fail_count)
       VALUES (?, ?, 'PROCESSING', 0, 0)`,
			[originalName, storedName],
		);
		uploadId = ins.insertId;

		// 2) 파일 읽기
		const filePath = req.file.path;
		const workbook = xlsx.readFile(filePath);
		const sheetNames = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
		if (!sheetNames.length) {
			await markUploadFailed(uploadId);
			await fs.unlink(req.file.path).catch(() => {});
			return renderRouteError(req, res, 400, '엑셀 파일에 시트가 없습니다.', '/admin/products/import');
		}
		const sheet = workbook.Sheets[sheetNames[0]];
		const rows = xlsx.utils.sheet_to_json(sheet);
		if (!rows.length) {
			await markUploadFailed(uploadId);
			await fs.unlink(req.file.path).catch(() => {});
			return renderRouteError(req, res, 400, '엑셀 파일에 불러올 데이터가 없습니다.', '/admin/products/import');
		}
		if (rows.length > 5000) {
			await markUploadFailed(uploadId);
			await fs.unlink(req.file.path).catch(() => {});
			return renderRouteError(req, res, 400, '엑셀 업로드는 5000행까지만 허용됩니다.', '/admin/products/import');
		}

		// [항목 4] 헤더 행 구조 검증: 필수 컬럼(name) 존재 여부 확인
		// xlsx.utils.sheet_to_json 은 첫 행을 헤더로 파싱하므로 rows[0]의 키를 확인
		const REQUIRED_HEADERS = ['name'];
		const actualHeaders = Object.keys(rows[0] || {});
		const missingHeaders = REQUIRED_HEADERS.filter(h => !actualHeaders.includes(h));
		if (missingHeaders.length > 0) {
			await markUploadFailed(uploadId);
			await fs.unlink(req.file.path).catch(() => {});
			return renderRouteError(
				req, res, 400,
				`엑셀 헤더가 올바르지 않습니다. 누락된 필수 컬럼: ${missingHeaders.join(', ')} (현재 헤더: ${actualHeaders.join(', ')})`,
				'/admin/products/import',
			);
		}

		// 카테고리 맵
		const [categories] = await db.execute('SELECT id, name FROM categories');
		const categoryMap = new Map(categories.map((c) => [c.name, c.id]));

		// [P-3] N+1 최적화: 루프 전에 엑셀의 모든 code를 한 번에 조회해 Map으로 캐싱
		// 기존: 행마다 SELECT id FROM products WHERE code = ? → N번 DB 쿼리
		// 개선: 루프 전 단일 IN 쿼리로 기존 products 조회 → 루프 내 O(1) Map 조회
		const incomingCodes = rows.map((r) => (r.code ? String(r.code).trim() : null)).filter(Boolean);
		const existingProductMap = new Map(); // code → product id
		if (incomingCodes.length > 0) {
			const placeholders = incomingCodes.map(() => '?').join(',');
			const [existingProducts] = await db.execute(
				`SELECT id, code FROM products WHERE code IN (${placeholders})`,
				incomingCodes,
			);
			for (const p of existingProducts) existingProductMap.set(p.code, p.id);
		}

		let successCount = 0;
		let failCount = 0;

		// 3) 처리 (루프 내 SELECT 제거 → 쓰기 쿼리만 실행)
		for (let i = 0; i < rows.length; i++) {
			try {
				const r = rows[i];
				const code = r.code ? String(r.code).trim() : null;
				const name = r.name ? String(r.name).trim() : null;
				const description = r.description ? String(r.description).trim() : null;
				const price = Number(r.price) || 0;
				const spec = r.spec ? String(r.spec).trim() : null;
				const image = r.image ? String(r.image).trim() : null;
				const categoryName = r.category_name ? String(r.category_name).trim() : null;
				const categoryId = categoryName ? categoryMap.get(categoryName) || null : null;

				if (!name) throw new Error('상품명이 누락되었습니다.');

				// [P-3] 루프 내 SELECT 제거: Map 캐시에서 O(1) 조회
				if (code && existingProductMap.has(code)) {
					const existingId = existingProductMap.get(code);
					await db.execute(`UPDATE products SET name=?, description=?, price=?, spec=?, image=?, category_id=? WHERE id=?`, [
						name,
						description,
						price,
						spec,
						image || null,
						categoryId,
						existingId,
					]);
					successCount++;
					continue;
				}

				await db.execute(
					`INSERT INTO products (code, name, description, price, spec, image, category_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
					[code, name, description, price, spec, image || null, categoryId],
				);
				// 새로 삽입된 code도 Map에 추가 (동일 파일 내 중복 code 처리)
				if (code) existingProductMap.set(code, null);
				successCount++;
			} catch (e) {
				failCount++;

				// 실패 row 저장
				await db.execute(
					`INSERT INTO upload_history_rows (upload_id, \`row_number\`, code, name, category_name, price, spec, image, description, reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						uploadId,
						i + 2,
						rows[i]?.code || null,
						rows[i]?.name || null,
						rows[i]?.category_name || null,
						rows[i]?.price || 0,
						rows[i]?.spec || null,
						rows[i]?.image || null,
						rows[i]?.description || null,
						String(e.message || 'unknown error'),
					],
				);
			}
		}

		// 업로드 파일 삭제
		await fs.unlink(req.file.path).catch(() => {});

		// 4) upload_histories 업데이트
		const status = failCount > 0 ? (successCount > 0 ? 'FAILED' : 'FAILED') : 'SUCCESS';
		await db.execute(`UPDATE upload_histories SET status=?, success_count=?, fail_count=? WHERE id=?`, [status, successCount, failCount, uploadId]);

		// 5) 같은 페이지로 돌아가서 알림 표시
		return res.redirect(`/admin/products/import?ok=1&uploadId=${uploadId}&success=${successCount}&fail=${failCount}`);
	} catch (err) {
		console.error(err);

		// 실패 시에도 히스토리 업데이트(가능하면)
		if (uploadId) {
			await markUploadFailed(uploadId);
		}

		return res.redirect(`/admin/products/import?ok=0&uploadId=${uploadId || ''}&success=0&fail=0`);
	}
});

// ✅ 상품 엑셀 다운로드
router.get('/products/export', async (req, res) => {
	try {
		const categoryId = req.query.category ? Number(req.query.category) : null;

		let sql = `
      SELECT
        p.id,
        p.code,
        p.name,
        c.name AS category_name,
        p.price,
        p.spec,
        p.image,
        p.description,
        p.created_at
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
    `;
		const params = [];

		if (categoryId) {
			sql += ` WHERE p.category_id = ?`;
			params.push(categoryId);
		}

		sql += ` ORDER BY p.id DESC`;

		const [rows] = await db.execute(sql, params);

		const worksheet = xlsx.utils.json_to_sheet(
			rows.map((r) => ({
				id: r.id,
				code: r.code,
				name: r.name,
				category_name: r.category_name,
				price: r.price,
				spec: r.spec,
				image: r.image,
				description: r.description,
				created_at: r.created_at,
			})),
		);

		worksheet['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 24 }, { wch: 16 }, { wch: 10 }, { wch: 24 }, { wch: 28 }, { wch: 40 }, { wch: 20 }];

		const wb = xlsx.utils.book_new();
		xlsx.utils.book_append_sheet(wb, worksheet, 'products');

		const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

		const fileName = categoryId ? `products_category_${categoryId}_${Date.now()}.xlsx` : `products_${Date.now()}.xlsx`;

		res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
		res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

		return res.send(buffer);
	} catch (err) {
		console.error(err);
		return renderRouteError(req, res, 500, '엑셀 다운로드 중 오류가 발생했습니다.');
	}
});

/* =========================
   카테고리
========================= */
router.get('/categories', async (req, res) => {
	try {
		const [categories] = await db.execute('SELECT * FROM categories ORDER BY id DESC');
		res.render('admin/categories', { categories, csrfToken: req.csrfToken() });
	} catch (err) {
		console.error(err);
		return renderRouteError(req, res, 500, '카테고리 로딩 오류');
	}
});

// [M-2] 명시적 CSRF 보호 (app-level 외 이중 방어)
router.post('/categories', csrfProtection, async (req, res) => {
	try {
		const name = String(req.body.name || '').trim();
		const slug = name.toLowerCase().replace(/\s+/g, '-');

		if (!name) return renderRouteError(req, res, 400, '카테고리 이름이 필요합니다.');

		await db.execute('INSERT INTO categories (name, slug) VALUES (?, ?)', [name, slug]);
		res.redirect('/admin/categories');
	} catch (err) {
		console.error(err);
		return renderRouteError(req, res, 500, '카테고리 추가 오류');
	}
});

// [M-2] 명시적 CSRF 보호
router.post('/categories/:id/delete', csrfProtection, async (req, res) => {
	try {
		const id = Number(req.params.id);

		const [[cnt]] = await db.execute('SELECT COUNT(*) AS cnt FROM products WHERE category_id=?', [id]);
		if (cnt.cnt > 0) return renderRouteError(req, res, 400, '이 카테고리를 사용하는 상품이 있습니다. 상품 카테고리를 먼저 변경해주세요.', '/admin/categories');

		await db.execute('DELETE FROM categories WHERE id=?', [id]);
		res.redirect('/admin/categories');
	} catch (err) {
		console.error(err);
		return renderRouteError(req, res, 500, '카테고리 삭제 오류');
	}
});

router.get('/categories/export', async (req, res) => {
	try {
		const [rows] = await db.execute(`
      SELECT id, name, slug
      FROM categories
      ORDER BY id DESC
    `);

		const ws = xlsx.utils.json_to_sheet(rows);
		const wb = xlsx.utils.book_new();
		xlsx.utils.book_append_sheet(wb, ws, 'categories');

		const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

		const fileName = `categories_${Date.now()}.xlsx`;
		res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
		res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
		return res.send(buffer);
	} catch (err) {
		console.error(err);
		return renderRouteError(req, res, 500, '카테고리 엑셀 다운로드 오류');
	}
});

router.get('/uploads/export', async (req, res) => {
	try {
		const [rows] = await db.execute(`
      SELECT id, original_name, stored_name, status, success_count, fail_count, created_at
      FROM upload_histories
      ORDER BY id DESC
    `);

		const ws = xlsx.utils.json_to_sheet(rows);
		const wb = xlsx.utils.book_new();
		xlsx.utils.book_append_sheet(wb, ws, 'upload_histories');

		const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

		const fileName = `upload_histories_${Date.now()}.xlsx`;
		res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
		res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
		return res.send(buffer);
	} catch (err) {
		console.error(err);
		return renderRouteError(req, res, 500, '업로드 히스토리 엑셀 다운로드 오류');
	}
});

router.get('/uploads/:id/fails/export', async (req, res) => {
	try {
		const uploadId = Number(req.params.id);
		if (!uploadId) return renderRouteError(req, res, 400, 'upload_id가 올바르지 않습니다.');

		const [rows] = await db.execute(
			`
      SELECT
        \`row_number\`, code, name, category_name, price, spec, image, description, reason, created_at
      FROM upload_history_rows
      WHERE upload_id = ?
      ORDER BY \`row_number\` ASC
    `,
			[uploadId],
		);

		const ws = xlsx.utils.json_to_sheet(rows);
		const wb = xlsx.utils.book_new();
		xlsx.utils.book_append_sheet(wb, ws, `fails_${uploadId}`);

		const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

		const fileName = `upload_${uploadId}_fails_${Date.now()}.xlsx`;
		res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
		res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
		return res.send(buffer);
	} catch (err) {
		console.error(err);
		return renderRouteError(req, res, 500, '실패 행 엑셀 다운로드 오류');
	}
});

/* =========================
   (관리자 내부) 상품 코드 중복 체크 (AJAX)
   - 기존 코드 유지: /admin/api/products/check-code
========================= */
router.get('/api/products/check-code', async (req, res) => {
	try {
		const code = String(req.query.code || '').trim();

		if (!code) {
			return res.status(400).json({ ok: false, message: 'code가 필요합니다.' });
		}

		const [rows] = await db.execute('SELECT id FROM products WHERE code = ? LIMIT 1', [code]);

		if (rows.length > 0) {
			return res.json({ ok: false, duplicated: true, message: '이미 사용 중인 코드입니다.' });
		}

		return res.json({ ok: true, duplicated: false, message: '사용 가능한 코드입니다.' });
	} catch (err) {
		console.error(err);
		return res.status(500).json({ ok: false, message: '중복 체크 중 오류' });
	}
});

/* =========================
   주문 관리
========================= */
router.get('/orders', async (req, res) => {
	try {
		const [orders] = await db.execute(
			`SELECT o.*, u.name AS user_name, u.email AS user_email,
        op.provider AS payment_provider, op.status AS payment_status
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       LEFT JOIN (
         SELECT op1.*
         FROM order_payments op1
         JOIN (
           SELECT order_id, MAX(id) AS max_id
           FROM order_payments
           GROUP BY order_id
         ) latest ON latest.max_id = op1.id
       ) op ON op.order_id = o.id
       ORDER BY o.created_at DESC`,
		);

		return res.render('admin/orders', { orders });
	} catch (err) {
		console.error(err);
		return renderRouteError(req, res, 500, '주문 목록 로딩 오류');
	}
});

router.get('/orders/:orderNumber', async (req, res) => {
	try {
		const orderNumber = String(req.params.orderNumber || '').trim();

		const [[order]] = await db.execute(
			`SELECT o.*, u.name AS user_name, u.email AS user_email
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       WHERE o.order_number = ?
       LIMIT 1`,
			[orderNumber],
		);

		if (!order) {
			return renderRouteError(req, res, 404, '주문 정보를 찾을 수 없습니다.');
		}

		const [items] = await db.execute(
			`SELECT *
       FROM order_items
       WHERE order_id = ?
       ORDER BY id ASC`,
			[order.id],
		);

		const [[payment]] = await db.execute(
			`SELECT *
       FROM order_payments
       WHERE order_id = ?
       ORDER BY id DESC
       LIMIT 1`,
			[order.id],
		);

		return res.render('admin/order-detail', { order, items, payment });
	} catch (err) {
		console.error(err);
		return renderRouteError(req, res, 500, '주문 상세 로딩 오류');
	}
});

/* =========================
   문의 관리
========================= */
router.get('/inquiries', async (req, res) => {
	try {
		const [inquiries] = await db.execute(
			`SELECT i.*, o.order_number, u.name AS user_name, u.email AS user_email
       FROM inquiries i
       LEFT JOIN orders o ON o.id = i.order_id
       LEFT JOIN users u ON u.id = i.user_id
       ORDER BY i.created_at DESC`,
		);

		return res.render('admin/inquiries', { inquiries });
	} catch (err) {
		console.error(err);
		return renderRouteError(req, res, 500, '문의 목록 로딩 오류');
	}
});

// [M-2] 명시적 CSRF 보호
router.post('/inquiries/:id/reply', csrfProtection, async (req, res) => {
	try {
		const inquiryId = Number(req.params.id);
		const answerContent = String(req.body.answerContent || '').trim();

		if (!inquiryId || !answerContent) {
			return renderRouteError(req, res, 400, '답변 내용이 필요합니다.');
		}

		const [[inquiry]] = await db.execute(
			`SELECT i.*, u.name AS user_name, u.email AS user_email
       FROM inquiries i
       LEFT JOIN users u ON u.id = i.user_id
       WHERE i.id = ?
       LIMIT 1`,
			[inquiryId],
		);

		if (!inquiry) {
			return renderRouteError(req, res, 404, '문의가 존재하지 않습니다.');
		}

		const recipientEmail = inquiry.user_email || inquiry.guest_email || null;
		const recipientName = inquiry.user_name || inquiry.guest_name || null;

		// 이메일 발송 시도
		let notificationChannel = recipientEmail ? 'EMAIL' : 'NONE';
		let notificationStatus = 'SKIPPED';
		let notificationError = recipientEmail ? null : '이메일 정보가 없습니다.';

		if (recipientEmail) {
			const emailResult = await sendInquiryReplyEmail({
				to: recipientEmail,
				name: recipientName,
				inquiryTitle: inquiry.title,
				replyContent: answerContent,
			});
			notificationStatus = emailResult.status || (emailResult.ok ? 'SENT' : 'FAILED');
			notificationError = emailResult.error || null;
		}

		await db.execute(
			`UPDATE inquiries
       SET status = 'ANSWERED',
		   answer_content = ?,
		   answered_at = NOW(),
		   notification_channel = ?,
		   notification_status = ?,
		   notification_error = ?
		   WHERE id = ?`,
			[answerContent, notificationChannel, notificationStatus, notificationError, inquiryId],
		);

		await logAdminAction(req, 'inquiry_reply', 'inquiry', inquiryId, true, {
			notificationChannel,
			notificationStatus,
		});

		return res.redirect('/admin/inquiries');
	} catch (err) {
		console.error(err);
		return renderRouteError(req, res, 500, '문의 답변 처리 중 오류가 발생했습니다.');
	}
});


// =============================================
// 검색 통계
// =============================================

// 페이지 뷰
router.get('/search-stats', requireAdmin, async (req, res) => {
	try {
		const days = Number(req.query.days || 30);

		const [summary, topKeywords, noHitKeywords, dailyVolume] = await Promise.all([
			searchLogService.getSummary({ days }),
			searchLogService.getTopKeywords({ days, limit: 20 }),
			searchLogService.getNoHitKeywords({ days, limit: 20 }),
			searchLogService.getDailySearchVolume({ days }),
		]);

		res.render('admin/search-stats', {
			title: '검색 통계',
			active: 'search-stats',
			summary,
			topKeywords,
			noHitKeywords,
			dailyVolume,
			days,
		});
	} catch (err) {
		console.error('[admin/search-stats]', err);
		return renderRouteError(req, res, 500, '검색 통계 조회 오류');
	}
});

// JSON API (차트 갱신용)
router.get('/api/search-stats', requireAdmin, async (req, res) => {
	try {
		const days = Number(req.query.days || 30);

		const [summary, topKeywords, noHitKeywords, dailyVolume] = await Promise.all([
			searchLogService.getSummary({ days }),
			searchLogService.getTopKeywords({ days, limit: 20 }),
			searchLogService.getNoHitKeywords({ days, limit: 20 }),
			searchLogService.getDailySearchVolume({ days }),
		]);

		res.json({ ok: true, days, summary, topKeywords, noHitKeywords, dailyVolume });
	} catch (err) {
		console.error('[admin/api/search-stats]', err);
		// [M-9] 에러 메시지 직접 노출 방지: SQL 구문/테이블명 등 내부 정보 유출 차단
		res.status(500).json({ ok: false, error: '검색 통계 조회 중 오류가 발생했습니다.' });
	}
});

// =============================================
// =============================================
// 계좌 입금 결제 상태 변경
// POST /admin/orders/:id/payment-status
// =============================================
router.post('/orders/:id/payment-status', requireAdmin, async (req, res) => {
	try {
		const orderId = Number(req.params.id);
		const status = String(req.body.status || '').trim().toUpperCase();
		const allowed = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELED'];

		if (!orderId || !allowed.includes(status)) {
			return res.status(400).json({ ok: false, message: '올바르지 않은 요청입니다.' });
		}

		await db.execute(
			`UPDATE order_payments SET status = ? WHERE order_id = ? AND provider = 'BANK_TRANSFER'`,
			[status, orderId],
		);

		if (status === 'CONFIRMED' || status === 'COMPLETED') {
			await db.execute(`UPDATE orders SET status = 'PAID' WHERE id = ?`, [orderId]);
		} else if (status === 'CANCELED') {
			await db.execute(`UPDATE orders SET status = 'CANCELED' WHERE id = ?`, [orderId]);
		}

		await logAdminAction(req, 'payment_status_update', 'order', orderId, true, { status });

		return res.json({ ok: true });
	} catch (err) {
		console.error('[admin/payment-status]', err);
		return res.status(500).json({ ok: false, message: '상태 변경 중 오류가 발생했습니다.' });
	}
});

// =============================================
// 세금계산서 관리
// =============================================
router.get('/tax-invoices', requireAdmin, async (req, res) => {
	try {
		const [requests] = await db.execute(
			`SELECT t.*, o.total_amount, o.status AS order_status
			 FROM tax_invoice_requests t
			 LEFT JOIN orders o ON o.id = t.order_id
			 ORDER BY t.requested_at DESC`,
		);

		return res.render('admin/tax-invoices', {
			requests,
			csrfToken: req.csrfToken ? req.csrfToken() : '',
			notice: req.query.notice ? String(req.query.notice) : null,
		});
	} catch (err) {
		console.error('[admin/tax-invoices]', err);
		return renderRouteError(req, res, 500, '세금계산서 목록 로딩 오류');
	}
});

router.post('/tax-invoices/:id/status', requireAdmin, csrfProtection, async (req, res) => {
	try {
		const id = Number(req.params.id);
		const status = String(req.body.status || '').trim().toUpperCase();
		const adminNote = String(req.body.admin_note || '').trim();
		const allowed = ['REQUESTED', 'PROCESSING', 'ISSUED', 'REJECTED'];

		if (!id || !allowed.includes(status)) {
			return res.status(400).json({ ok: false, message: '올바르지 않은 요청입니다.' });
		}

		await db.execute(
			`UPDATE tax_invoice_requests
			 SET status = ?, admin_note = ?, processed_at = NOW()
			 WHERE id = ?`,
			[status, adminNote || null, id],
		);

		await logAdminAction(req, 'tax_invoice_status', 'tax_invoice', id, true, { status, adminNote });

		return res.redirect('/admin/tax-invoices?notice=' + encodeURIComponent('상태가 업데이트되었습니다.'));
	} catch (err) {
		console.error('[admin/tax-invoices/status]', err);
		return renderRouteError(req, res, 500, '세금계산서 상태 변경 오류');
	}
});

// 이메일 드라이버 테스트
// =============================================

router.post('/test-email', requireAdmin, async (req, res) => {
	const adminEmail =
		process.env.ADMIN_EMAIL ||
		process.env.EMAIL_FROM ||
		process.env.SMTP_USER ||
		process.env.NCP_EMAIL_SENDER;

	if (!adminEmail) {
		return res.status(400).json({ ok: false, error: 'ADMIN_EMAIL / EMAIL_FROM 환경변수가 없습니다.' });
	}

	if (!isEmailConfigured()) {
		return res.status(400).json({
			ok: false,
			driver: getDriverName(),
			error: `현재 드라이버(${getDriverName()})가 올바르게 설정되지 않았습니다.`,
		});
	}

	const result = await sendMail({
		to: adminEmail,
		subject: '[ENERMADE] 이메일 드라이버 테스트',
		html: `<p>이 메일은 관리자 대시보드에서 발송한 테스트 메일입니다.</p>
               <p>드라이버: <strong>${getDriverName()}</strong></p>
               <p>발송 시각: ${new Date().toLocaleString('ko-KR')}</p>`,
	});

	return res.json({ ...result, driver: getDriverName(), to: adminEmail });
});

module.exports = router;
