// routes/admin.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const xlsx = require('xlsx');
const fs = require('fs/promises');
const fssync = require('fs');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const sharp = require('sharp');
const os = require('os');
const { exec } = require('child_process');
const csurf = require('csurf');

const router = express.Router();
const csrfProtection = csurf({ ignoreMethods: ['GET', 'HEAD', 'OPTIONS'] });

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

/* =========================
   업로드/이미지 설정
========================= */
const upload = multer({ dest: 'uploads/' });

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
	const base = `p_${Date.now()}`;
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
		});
	} catch (err) {
		console.error(err);
		res.status(500).send('대시보드 로딩 오류');
	}
});

/* =========================
   상품 목록
========================= */
router.get('/products', async (req, res) => {
	try {
		const [products] = await db.execute(`
			SELECT p.*, c.name AS category_name
			FROM products p
			LEFT JOIN categories c ON c.id = p.category_id
			ORDER BY p.id DESC
		`);
		res.render('admin/products', { products, csrfToken: req.csrfToken() });
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 목록 로딩 오류');
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
		res.status(500).send('상품 등록 페이지 로딩 오류');
	}
});

router.post('/products/new', uploadImage.single('imageFile'), csrfProtection, async (req, res) => {
	try {
		const { code, name, description, price, spec, category_id, image } = req.body;

		let imagePath = image || null;
		let thumbPath = null;

		if (req.file) {
			const processed = await processImageToWebp(req.file.path);
			// multer 임시파일 삭제
			await fs.unlink(req.file.path).catch(() => {});
			imagePath = processed.image;
			thumbPath = processed.image_thumb;
		}

		await db.execute(
			`INSERT INTO products (code, name, description, price, spec, image, image_thumb, category_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[code || null, name, description || null, Number(price) || 0, spec || null, imagePath, thumbPath, category_id || null],
		);

		return res.redirect('/admin/products');
	} catch (err) {
		console.error(err);
		return res.status(500).send('상품 등록 오류');
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

		if (!product) return res.status(404).send('상품 없음');

		res.render('admin/admin-product-edit', {
			product,
			categories,
			csrfToken: req.csrfToken(),
		});
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 수정 페이지 로딩 오류');
	}
});

router.post('/products/:id/edit', uploadImage.single('imageFile'), csrfProtection, async (req, res) => {
	try {
		const productId = Number(req.params.id);
		const { code, name, description, price, spec, category_id, image } = req.body;

		// 기존 이미지 유지용 조회
		const [rows] = await db.execute('SELECT image, image_thumb FROM products WHERE id = ? LIMIT 1', [productId]);
		if (!rows.length) return res.status(404).send('상품 없음');

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

		await db.execute(
			`UPDATE products
       SET code=?, name=?, description=?, price=?, spec=?, image=?, image_thumb=?, category_id=?
       WHERE id=?`,
			[code || null, name, description || null, Number(price) || 0, spec || null, imagePath, thumbPath, category_id || null, productId],
		);

		return res.redirect('/admin/products');
	} catch (err) {
		console.error(err);
		return res.status(500).send('상품 수정 오류');
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

		res.redirect('/admin/products');
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 삭제 오류');
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

router.post('/products/import', upload.single('file'), csrfProtection, async (req, res) => {
	let uploadId = null;

	try {
		if (!req.file) return res.status(400).send('업로드 파일이 필요합니다.');

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
		const sheet = workbook.Sheets[workbook.SheetNames[0]];
		const rows = xlsx.utils.sheet_to_json(sheet);

		// 카테고리 맵
		const [categories] = await db.execute('SELECT id, name FROM categories');
		const categoryMap = new Map(categories.map((c) => [c.name, c.id]));

		let successCount = 0;
		let failCount = 0;

		// 3) 처리
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

				// code가 있으면 upsert 느낌으로 처리
				if (code) {
					const [[existing]] = await db.execute('SELECT id FROM products WHERE code = ? LIMIT 1', [code]);
					if (existing) {
						await db.execute(`UPDATE products SET name=?, description=?, price=?, spec=?, image=?, category_id=? WHERE id=?`, [
							name,
							description,
							price,
							spec,
							image || null,
							categoryId,
							existing.id,
						]);
						successCount++;
						continue;
					}
				}

				await db.execute(
					`INSERT INTO products (code, name, description, price, spec, image, category_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
					[code, name, description, price, spec, image || null, categoryId],
				);
				successCount++;
			} catch (e) {
				failCount++;

				// 실패 row 저장 (테이블 컬럼명은 너 DB에 맞춰 유지)
				await db.execute(
					`INSERT INTO upload_history_rows (upload_id, row_number, code, name, category_name, price, spec, image, description, reason)
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
			await db.execute(`UPDATE upload_histories SET status='FAILED' WHERE id=?`, [uploadId]).catch(() => {});
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
		return res.status(500).send('엑셀 다운로드 중 오류가 발생했습니다.');
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
		res.status(500).send('카테고리 로딩 오류');
	}
});

router.post('/categories', async (req, res) => {
	try {
		const name = String(req.body.name || '').trim();
		const slug = name.toLowerCase().replace(/\s+/g, '-');

		if (!name) return res.status(400).send('카테고리 이름이 필요합니다.');

		await db.execute('INSERT INTO categories (name, slug) VALUES (?, ?)', [name, slug]);
		res.redirect('/admin/categories');
	} catch (err) {
		console.error(err);
		res.status(500).send('카테고리 추가 오류');
	}
});

router.post('/categories/:id/delete', async (req, res) => {
	try {
		const id = Number(req.params.id);

		const [[cnt]] = await db.execute('SELECT COUNT(*) AS cnt FROM products WHERE category_id=?', [id]);
		if (cnt.cnt > 0) return res.send('이 카테고리를 사용하는 상품이 있습니다.');

		await db.execute('DELETE FROM categories WHERE id=?', [id]);
		res.redirect('/admin/categories');
	} catch (err) {
		console.error(err);
		res.status(500).send('카테고리 삭제 오류');
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
		return res.status(500).send('카테고리 엑셀 다운로드 오류');
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
		return res.status(500).send('업로드 히스토리 엑셀 다운로드 오류');
	}
});

router.get('/uploads/:id/fails/export', async (req, res) => {
	try {
		const uploadId = Number(req.params.id);
		if (!uploadId) return res.status(400).send('upload_id가 올바르지 않습니다.');

		const [rows] = await db.execute(
			`
      SELECT
        row_number, code, name, category_name, price, spec, image, description, reason, created_at
      FROM upload_history_rows
      WHERE upload_id = ?
      ORDER BY row_number ASC
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
		return res.status(500).send('실패 행 엑셀 다운로드 오류');
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
		return res.status(500).send('주문 목록 로딩 오류');
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
			return res.status(404).send('주문 정보를 찾을 수 없습니다.');
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
		return res.status(500).send('주문 상세 로딩 오류');
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
		return res.status(500).send('문의 목록 로딩 오류');
	}
});

module.exports = router;
