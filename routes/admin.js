const express = require('express');
const multer = require('multer');
const path = require('path');
const xlsx = require('xlsx');
const fs = require('fs/promises');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const sharp = require('sharp');
const os = require('os');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });
const storage = multer.diskStorage({
	destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'tmp')),
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

const { exec } = require('child_process');

function execAsync(cmd) {
	return new Promise((resolve) => {
		exec(cmd, (err, stdout) => {
			if (err) return resolve('');
			resolve(String(stdout || '').trim());
		});
	});
}

async function processImageToWebp(reqFilePath) {
	const base = `p_${Date.now()}`;
	const fileName = `${base}.webp`;
	const thumbName = `${base}_thumb.webp`;

	const outDir = path.join(__dirname, '..', 'public', 'uploads');
	const outFull = path.join(outDir, fileName);
	const outThumb = path.join(outDir, thumbName);

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
router.get('/', (req, res) => {
	return res.redirect('/admin/dashboard');
});

router.get('/dashboard', async (req, res) => {
	try {
		const [[productCnt]] = await db.execute('SELECT COUNT(*) AS cnt FROM products');
		const [[categoryCnt]] = await db.execute('SELECT COUNT(*) AS cnt FROM categories');

		// --- 시스템 상태 ---
		const load = os.loadavg(); // [1m,5m,15m]
		const totalMem = os.totalmem();
		const freeMem = os.freemem();
		const usedMem = totalMem - freeMem;

		// 디스크 사용량(루트)
		const df = await execAsync(`df -h / | tail -n 1 | awk '{print $2,$3,$4,$5}'`);
		// nginx 응답 체크
		const nginxHead = await execAsync(`curl -I -s http://127.0.0.1:8080/ | head -n 1`);
		// vnstat (있으면)
		const vn = await execAsync(`vnstat --oneline 2>/dev/null`);

		res.render('admin/dashboard', {
			stats: {
				productCnt: productCnt.cnt,
				categoryCnt: categoryCnt.cnt,
			},
			sys: {
				load1: load[0],
				load5: load[1],
				load15: load[2],
				memTotalMB: Math.round(totalMem / 1024 / 1024),
				memUsedMB: Math.round(usedMem / 1024 / 1024),
				memFreeMB: Math.round(freeMem / 1024 / 1024),
				diskLine: df, // "총 사용 가능 사용%"
				nginxHead: nginxHead, // "HTTP/1.1 200 OK"
				vnstatLine: vn, // 길게 한 줄
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

		res.render('admin/products', { products });
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 목록 로딩 오류');
	}
});

/* =========================
   상품 등록
========================= */
router.get('/products/new', async (req, res) => {
	const [categories] = await db.execute('SELECT id, name FROM categories ORDER BY name');
	res.render('admin/admin-product-new', { categories });
});

router.post('/products/new', uploadImage.single('imageFile'), async (req, res) => {
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
	const productId = Number(req.params.id);

	const [[product]] = await db.execute('SELECT * FROM products WHERE id = ?', [productId]);
	const [categories] = await db.execute('SELECT id, name FROM categories ORDER BY name');

	if (!product) return res.status(404).send('상품 없음');

	res.render('admin/admin-product-edit', { product, categories });
});

router.post('/products/:id/edit', uploadImage.single('imageFile'), async (req, res) => {
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
	const productId = Number(req.params.id);

	await db.execute('DELETE FROM cart_items WHERE product_id = ?', [productId]);
	await db.execute('DELETE FROM products WHERE id = ?', [productId]);

	res.redirect('/admin/products');
});

/* =========================
   엑셀 업로드
========================= */
router.get('/products/import', async (req, res) => {
	try {
		// 업로드 히스토리 테이블명이 예: upload_histories 라고 가정
		// 너 프로젝트에서 테이블명 다르면 여기만 바꾸면 됨
		const [uploads] = await db.execute(`
      SELECT id, original_name, stored_name, status, success_count, fail_count, created_at
      FROM upload_histories
      ORDER BY id DESC
      LIMIT 30
    `);

		return res.render('admin/admin-product-import', { uploads });
	} catch (err) {
		console.error(err);
		// 히스토리 못 불러와도 페이지는 떠야 하니까 빈 배열
		return res.render('admin/admin-product-import', { uploads: [] });
	}
});

router.post('/products/import', upload.single('file'), async (req, res) => {
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

	// 🔥 업로드 파일 삭제 (C-4)
	await fs.unlink(filePath);

	res.render('admin/import-result', {
		success,
		fail,
	});
});

// ✅ 상품 엑셀 다운로드
router.get('/products/export', requireAdmin, async (req, res) => {
	try {
		// (선택) 카테고리 필터: /admin/products/export?category=3
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

		// 1) JSON -> Sheet
		const worksheet = xlsx.utils.json_to_sheet(
			rows.map((r) => ({
				id: r.id,
				code: r.code,
				name: r.name,
				category_name: r.category_name,
				price: r.price,
				spec: r.spec, // ✅ spec 포함
				image: r.image,
				description: r.description,
				created_at: r.created_at,
			})),
		);

		// (선택) 컬럼 폭 자동 느낌
		worksheet['!cols'] = [
			{ wch: 6 }, // id
			{ wch: 14 }, // code
			{ wch: 24 }, // name
			{ wch: 16 }, // category_name
			{ wch: 10 }, // price
			{ wch: 24 }, // spec
			{ wch: 28 }, // image
			{ wch: 40 }, // description
			{ wch: 20 }, // created_at
		];

		// 2) Workbook 생성
		const wb = xlsx.utils.book_new();
		xlsx.utils.book_append_sheet(wb, worksheet, 'products');

		// 3) Buffer로 만들어서 다운로드 응답
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
	const [categories] = await db.execute('SELECT * FROM categories ORDER BY id DESC');
	res.render('admin/categories', { categories });
});

router.post('/categories', async (req, res) => {
	const name = req.body.name.trim();
	const slug = name.toLowerCase().replace(/\s+/g, '-');

	await db.execute('INSERT INTO categories (name, slug) VALUES (?, ?)', [name, slug]);
	res.redirect('/admin/categories');
});

router.post('/categories/:id/delete', async (req, res) => {
	const id = Number(req.params.id);

	const [[cnt]] = await db.execute('SELECT COUNT(*) AS cnt FROM products WHERE category_id=?', [id]);

	if (cnt.cnt > 0) {
		return res.send('이 카테고리를 사용하는 상품이 있습니다.');
	}

	await db.execute('DELETE FROM categories WHERE id=?', [id]);
	res.redirect('/admin/categories');
});

router.get('/categories/export', requireAdmin, async (req, res) => {
	try {
		const [rows] = await db.execute(`
      SELECT id, name, slug, created_at
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

router.get('/uploads/export', requireAdmin, async (req, res) => {
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

router.get('/uploads/:id/fails/export', requireAdmin, async (req, res) => {
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

// routes/admin.js 상단에 이미 requireAdmin, router.use(requireAdmin) 되어있다고 가정

// ✅ 상품 코드 중복 체크 (AJAX)
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
