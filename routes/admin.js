const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

router.use(requireAdmin);

// 관리자 홈(원하면 만들기)
router.get('/', (req, res) => {
	res.render('admin/index'); // ✅ views/admin/index.ejs
});

// 상품 등록 폼
router.get('/products/new', (req, res) => res.render('admin/admin-product-new'));

// 상품 등록 처리
router.post('/products/new', async (req, res) => {
	try {
		const { code, name, description, price, spec, image, category_id } = req.body;
		const priceValue = Number(price);

		if (!name) return res.send('상품명은 필수입니다.');
		if (Number.isNaN(priceValue) || priceValue <= 0) return res.send('가격은 0보다 큰 숫자여야 합니다.');

		await db.execute(
			`INSERT INTO products (code, name, description, price, spec, image, category_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[code || null, name, description || null, priceValue, spec || null, image || null, category_id ? Number(category_id) : null]
		);

		res.redirect('/shop/products');
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 등록 중 오류');
	}
});

// 엑셀 업로드 폼
router.get('/products/import', (req, res) => res.render('admin/admin-product-import'));

// 엑셀 업로드 처리
router.post('/products/import', upload.single('file'), async (req, res) => {
	try {
		if (!req.file) return res.send('업로드된 파일이 없습니다.');

		const workbook = xlsx.readFile(req.file.path);
		const sheet = workbook.Sheets[workbook.SheetNames[0]];
		const rows = xlsx.utils.sheet_to_json(sheet);

		for (const row of rows) {
			const { code, name, category_slug, price, spec, image, description } = row;
			if (!name) continue;

			let categoryId = null;
			if (category_slug) {
				const [cats] = await db.execute('SELECT id FROM categories WHERE slug = ? LIMIT 1', [category_slug]);
				if (cats.length > 0) categoryId = cats[0].id;
			}

			await db.execute(
				`
        INSERT INTO products (code, name, category_id, price, spec, image, description)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          category_id = VALUES(category_id),
          price = VALUES(price),
          spec = VALUES(spec),
          image = VALUES(image),
          description = VALUES(description)
        `,
				[code || null, name, categoryId, Number(price) || 0, spec || null, image || null, description || null]
			);
		}

		res.send('엑셀 업로드 및 상품 반영 완료!');
	} catch (err) {
		console.error(err);
		res.status(500).send('엑셀 처리 중 오류');
	}
});

// slug 자동 생성(한글 허용)
function slugify(input) {
	return String(input || '')
		.trim()
		.toLowerCase()
		.replace(/\s+/g, '-') // 공백 -> -
		.replace(/[^a-z0-9\uAC00-\uD7A3-]/g, '') // 영문/숫자/한글/-
		.replace(/-+/g, '-') // --- -> -
		.replace(/^-|-$/g, ''); // 앞뒤 - 제거
}

// ✅ 카테고리 목록
router.get('/categories', async (req, res) => {
	const [categories] = await db.execute('SELECT id, name, slug, created_at FROM categories ORDER BY id DESC');
	res.render('admin/categories', { categories });
});

// ✅ 카테고리 추가
router.post('/categories', async (req, res) => {
	try {
		const name = (req.body.name || '').trim();
		if (!name) return res.send('카테고리 이름이 필요합니다.');

		let slug = slugify(req.body.slug || name);
		if (!slug) slug = `cat-${Date.now()}`;

		// slug 중복이면 뒤에 -2, -3 붙이기
		let uniqueSlug = slug;
		let i = 2;
		while (true) {
			const [rows] = await db.execute('SELECT id FROM categories WHERE slug = ? LIMIT 1', [uniqueSlug]);
			if (rows.length === 0) break;
			uniqueSlug = `${slug}-${i++}`;
		}

		await db.execute('INSERT INTO categories (name, slug) VALUES (?, ?)', [name, uniqueSlug]);
		return res.redirect('/admin/categories');
	} catch (err) {
		console.error(err);
		return res.status(500).send('카테고리 추가 중 오류');
	}
});

// ✅ 카테고리 삭제
router.post('/categories/:id/delete', async (req, res) => {
	try {
		const id = Number(req.params.id);

		// ✅ 1) 이 카테고리를 쓰는 상품이 있는지 체크
		const [cntRows] = await db.execute('SELECT COUNT(*) AS cnt FROM products WHERE category_id = ?', [id]);

		const cnt = Number(cntRows[0]?.cnt || 0);
		if (cnt > 0) {
			return res.send(`이 카테고리를 사용하는 상품이 ${cnt}개 있습니다. 상품의 카테고리를 변경/해제한 뒤 삭제하세요.`);
		}

		// ✅ 2) 상품이 없으면 삭제
		await db.execute('DELETE FROM categories WHERE id = ?', [id]);
		return res.redirect('/admin/categories');
	} catch (err) {
		console.error(err);
		return res.status(500).send('카테고리 삭제 중 오류');
	}
});

// ✅ 상품 목록
router.get('/products', async (req, res) => {
	try {
		const [products] = await db.execute(
			`
      SELECT p.*, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      ORDER BY p.id DESC
      `
		);
		res.render('admin/products', { products });
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 목록 불러오기 오류');
	}
});

// ✅ 상품 수정 폼
router.get('/products/:id/edit', async (req, res) => {
	try {
		const id = Number(req.params.id);

		const [rows] = await db.execute(
			`
      SELECT * FROM products
      WHERE id = ? LIMIT 1
      `,
			[id]
		);
		if (!rows.length) return res.status(404).render('404', { message: '상품을 찾을 수 없습니다.' });

		const [categories] = await db.execute('SELECT id, name FROM categories ORDER BY name ASC');

		res.render('admin/admin-product-edit', { product: rows[0], categories });
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 수정 폼 오류');
	}
});

// ✅ 상품 수정 처리
router.post('/products/:id/edit', async (req, res) => {
	try {
		const id = Number(req.params.id);
		const { code, name, description, price, spec, image, category_id } = req.body;

		const priceValue = Number(price);
		if (!name) return res.send('상품명은 필수입니다.');
		if (Number.isNaN(priceValue) || priceValue < 0) return res.send('가격이 올바르지 않습니다.');

		await db.execute(
			`
      UPDATE products
      SET code = ?,
          name = ?,
          description = ?,
          price = ?,
          spec = ?,
          image = ?,
          category_id = ?
      WHERE id = ?
      `,
			[code || null, name, description || null, priceValue, spec || null, image || null, category_id ? Number(category_id) : null, id]
		);

		res.redirect('/admin/products');
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 수정 처리 오류');
	}
});

// ✅ 상품 삭제
router.post('/products/:id/delete', async (req, res) => {
	try {
		const id = Number(req.params.id);
		await db.execute('DELETE FROM products WHERE id = ?', [id]);
		res.redirect('/admin/products');
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 삭제 오류');
	}
});

module.exports = router;
