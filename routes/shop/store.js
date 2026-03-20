const express = require('express');
const csurf = require('../../lib/csurf');
const db = require('../../db');
const { requireLogin } = require('../../middleware/auth');
const { ensureProductVisibilityColumn, ensureReviewTable, ensureReviewUniqueConstraint, ensureWishlistTable } = require('../../lib/migrations');

const router = express.Router();
const storeCsrf = csurf({ ignoreMethods: ['GET', 'HEAD', 'OPTIONS'] });

router.get('/', async (req, res) => {
	try {
		await ensureProductVisibilityColumn();
		const [categories] = await db.execute('SELECT * FROM categories ORDER BY name ASC');
		const [latest] = await db.execute(`
      SELECT p.*, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.visibility_status <> 'HIDDEN'
      ORDER BY p.created_at DESC
      LIMIT 8
    `);

		res.render('shop/index', { categories, latest, totalCount: latest.length });
	} catch (err) {
		console.error(err);
		return res.redirect('/shop/products');
	}
});

router.get('/products', async (req, res) => {
	try {
		await ensureProductVisibilityColumn();
		const categorySlug = req.query.category || 'all';
		const q = (req.query.q || '').trim();

		const [categories] = await db.execute('SELECT * FROM categories ORDER BY name ASC');

		let sql = `
      SELECT p.*, c.name AS category_name, c.slug AS category_slug
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
    `;
		const params = [];
		const where = [];

		where.push("p.visibility_status <> 'HIDDEN'");

		if (categorySlug !== 'all') {
			where.push('c.slug = ?');
			params.push(categorySlug);
		}

		if (q) {
			where.push('(p.name LIKE ? OR p.code LIKE ? OR p.spec LIKE ?)');
			params.push(`%${q}%`, `%${q}%`, `%${q}%`);
		}

		if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
		sql += ' ORDER BY p.created_at DESC';

		const [products] = await db.execute(sql, params);

		res.render('shop/products', {
			products,
			categories,
			currentCategory: categorySlug,
			query: q,
		});
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 목록 오류');
	}
});

router.get('/products/:id', async (req, res) => {
	try {
		const productId = Number(req.params.id);

		await ensureProductVisibilityColumn();
		await ensureReviewTable();
		await ensureWishlistTable();

		const [rows] = await db.execute(
			`
      SELECT p.*, c.name AS category_name, c.slug AS category_slug
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = ? AND p.visibility_status <> 'HIDDEN' LIMIT 1
      `,
			[productId]
		);

		if (!rows.length) return res.status(404).render('404', { message: '상품을 찾을 수 없습니다.' });

		const product = rows[0];
		const [reviews] = await db.execute(
			`SELECT r.*, u.name AS user_name
       FROM product_reviews r
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.product_id = ?
       ORDER BY r.created_at DESC`,
			[productId],
		);

		const [[reviewStats]] = await db.execute(
			`SELECT COUNT(*) AS review_count, AVG(rating) AS avg_rating
       FROM product_reviews
       WHERE product_id = ?`,
			[productId],
		);

		let wished = false;
		if (req.session.user) {
			const [[wishRow]] = await db.execute(
				`SELECT 1
         FROM user_wishlist
         WHERE user_id = ? AND product_id = ?
         LIMIT 1`,
				[req.session.user.id, productId],
			);
			wished = Boolean(wishRow);
		}

		const [related] = await db.execute(
			`SELECT id, name, price, image
       FROM products
       WHERE category_id <=> ?
         AND id <> ?
       ORDER BY created_at DESC
       LIMIT 4`,
			[product.category_id, productId],
		);

		res.render('shop/product-detail', {
			product,
			reviews,
			reviewStats,
			wished,
			related,
			metaDescription: `${product.name} - ${product.description ? product.description.slice(0, 120) : '세라믹 부품 상세 정보를 확인하세요.'}`,
		});
	} catch (err) {
		console.error(err);
		res.status(500).send('상품 상세 오류');
	}
});

router.post('/products/:id/reviews', requireLogin, storeCsrf, async (req, res) => {
	try {
		const productId = Number(req.params.id);
		const rating = Number(req.body.rating);
		const content = String(req.body.content || '').trim();

		if (!productId || !rating || rating < 1 || rating > 5 || !content) {
			return res.redirect(`/shop/products/${productId}`);
		}

		await ensureReviewTable();
		await ensureReviewUniqueConstraint();

		// M-5: 사용자당 상품 리뷰 1건 제한 — 중복 방지 사전 확인
		const [[existingReview]] = await db.execute(
			'SELECT 1 FROM product_reviews WHERE product_id = ? AND user_id = ? LIMIT 1',
			[productId, req.session.user.id],
		);
		if (existingReview) {
			return res.redirect(`/shop/products/${productId}#reviews`);
		}

		await db.execute(
			`INSERT INTO product_reviews (product_id, user_id, rating, content)
       VALUES (?, ?, ?, ?)`,
			[productId, req.session.user.id, rating, content],
		);

		return res.redirect(`/shop/products/${productId}#reviews`);
	} catch (err) {
		console.error(err);
		return res.status(500).send('리뷰 등록 중 오류가 발생했습니다.');
	}
});

router.get('/wishlist', requireLogin, async (req, res) => {
	try {
		await ensureWishlistTable();
		const [items] = await db.execute(
			`SELECT p.id, p.name, p.price, p.image
       FROM user_wishlist w
       JOIN products p ON p.id = w.product_id
       WHERE w.user_id = ?
       ORDER BY w.created_at DESC`,
			[req.session.user.id],
		);

		return res.render('shop/wishlist', {
			items,
			active: 'wishlist',
		});
	} catch (err) {
		console.error(err);
		return res.status(500).send('위시리스트 로딩 중 오류가 발생했습니다.');
	}
});

router.post('/wishlist/toggle', requireLogin, storeCsrf, async (req, res) => {
	try {
		const productId = Number(req.body.productId);
		if (!productId) return res.redirect('/shop/products');

		await ensureWishlistTable();
		const [[existing]] = await db.execute(
			`SELECT 1 FROM user_wishlist WHERE user_id = ? AND product_id = ? LIMIT 1`,
			[req.session.user.id, productId],
		);

		if (existing) {
			await db.execute(`DELETE FROM user_wishlist WHERE user_id = ? AND product_id = ?`, [
				req.session.user.id,
				productId,
			]);
		} else {
			await db.execute(`INSERT INTO user_wishlist (user_id, product_id) VALUES (?, ?)`, [
				req.session.user.id,
				productId,
			]);
		}

		return res.redirect(`/shop/products/${productId}`);
	} catch (err) {
		console.error(err);
		return res.status(500).send('위시리스트 처리 중 오류가 발생했습니다.');
	}
});

module.exports = router;
