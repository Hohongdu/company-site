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
				productCnt: productCnt.cnt,
				categoryCnt: categoryCnt.cnt,
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
router.get('/products/import', async (req, res) => {
	try {
		// 업로드 히스토리 테이블명이 예: upload_histories 라고 가정
		const [uploads] = await db.execute(`
      SELECT id, original_name, stored_name, status, success_count, fail_count, created_at
      FROM upload_histories
      ORDER BY id DESC
      LIMIT 30
    `);

		return res.render('admin/admin-product-import', { uploads });
	} catch (err) {
		console.error(err);
		return res.render('admin/admin-product-import', { uploads: [] });
	}
});

router.post('/products/import', upload.single('file'), csrfProtection, async (req, res) => {
	try {
		const filePath = req.file.path;
		const workbook = xlsx.readFile(filePath);
		const sheet = workbook.Sheets[workbook.SheetNames[0]];
		const rows = xlsx.utils.sheet_to_json(sheet);

		const success = [];
		const fail = [];

		for (let i = 0; i < rows.length; i++) {
			try {
				const r = rows[i];

				await db.execute(
					`INSERT INTO products (code, name, price, spec)
					 VALUES (?, ?, ?, ?)`,
					[r.code || null, r.name, Number(r.price) || 0, r.spec || null],
				);

				success.push({ row: i + 2, name: r.name });
			} catch (err) {
				fail.push({
					row: i + 2,
					reason: err.message,
				});
			}
		}

		// 업로드 파일 삭제
		await fs.unlink(filePath).catch(() => {});

		res.render('admin/import-result', { success, fail });
	} catch (err) {
		console.error(err);
		res.status(500).send('엑셀 업로드 처리 오류');
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

module.exports = router;
