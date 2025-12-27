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
	// 대시보드 뷰가 없으면 여기 주석처리해도 됨
	res.send('admin ok');
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

module.exports = router;
