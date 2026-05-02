// lib/cart.js
const db = require('../db');

// 게스트 장바구니(세션) 구조:
// req.session.guestCart = { items: { [productId]: quantity } }
function getGuestCart(req) {
	if (!req.session.guestCart) req.session.guestCart = { items: {} };
	return req.session.guestCart;
}

async function ensureUserCartId(userId) {
	const [rows] = await db.execute('SELECT id FROM carts WHERE user_id = ? LIMIT 1', [userId]);
	if (rows.length) return rows[0].id;

	const [result] = await db.execute('INSERT INTO carts (user_id) VALUES (?)', [userId]);
	return result.insertId;
}

async function getCartViewData(req) {
	// 로그인 상태면 DB 장바구니, 아니면 세션 장바구니
	if (req.session.user) {
		const userId = req.session.user.id;
		const cartId = await ensureUserCartId(userId);

		const [items] = await db.execute(
			`
      SELECT
        ci.id AS cart_item_id,
        ci.cart_id,
        ci.product_id,
        ci.quantity,
        p.name,
        p.price,
        p.image,
        p.spec
      FROM cart_items ci
      JOIN products p ON p.id = ci.product_id
      WHERE ci.cart_id = ?
      ORDER BY ci.id DESC
      `,
			[cartId]
		);

		const totalAmount = items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0);

		return { isGuest: false, items, totalAmount };
	}

	// guest
	const guestCart = getGuestCart(req);
	const productIds = Object.keys(guestCart.items)
		.map((x) => Number(x))
		.filter(Boolean);

	if (productIds.length === 0) return { isGuest: true, items: [], totalAmount: 0 };

	const placeholders = productIds.map(() => '?').join(',');
	const [products] = await db.execute(
		`SELECT id, name, price, image, spec FROM products WHERE id IN (${placeholders})`,
		productIds,
	);

	const items = products.map((p) => ({
		cart_item_id: null,
		product_id: p.id,
		quantity: Number(guestCart.items[p.id]) || 1,
		name: p.name,
		price: p.price,
		image: p.image,
		spec: p.spec,
	}));

	const totalAmount = items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0);

	return { isGuest: true, items, totalAmount };
}

async function mergeGuestCartToUserCart(req) {
	if (!req.session.guestCart?.items) return;

	const userId = req.session.user?.id;
	if (!userId) return;

	const items = req.session.guestCart.items;
	const productIds = Object.keys(items);
	if (!productIds.length) return;

	const cartId = await ensureUserCartId(userId);
	const connection = await db.getConnection();

	try {
		await connection.beginTransaction();

		for (const pid of productIds) {
			const productId = Number(pid);
			const qty = Math.max(1, Number(items[pid]) || 1);

			const [exist] = await connection.execute(
				'SELECT id FROM cart_items WHERE cart_id = ? AND product_id = ? LIMIT 1',
				[cartId, productId],
			);

			if (exist.length) {
				await connection.execute(
					'UPDATE cart_items SET quantity = quantity + ? WHERE id = ?',
					[qty, exist[0].id],
				);
			} else {
				await connection.execute(
					'INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)',
					[cartId, productId, qty],
				);
			}
		}

		await connection.commit();
		// 전체 성공 후에만 세션 초기화
		req.session.guestCart = { items: {} };
	} catch (err) {
		await connection.rollback();
		// 세션 카트를 유지해 다음 로그인 시 재시도
		console.error('[cart-merge] 트랜잭션 롤백:', err.message);
	} finally {
		connection.release();
	}
}

async function clearCart(req) {
	if (req.session.user) {
		const cartId = await ensureUserCartId(req.session.user.id);
		await db.execute('DELETE FROM cart_items WHERE cart_id = ?', [cartId]);
		return;
	}

	req.session.guestCart = { items: {} };
}

module.exports = {
	getGuestCart,
	ensureUserCartId,
	getCartViewData,
	mergeGuestCartToUserCart,
	clearCart,
};
