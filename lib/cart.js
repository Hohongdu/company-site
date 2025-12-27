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
        p.image
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
	const [products] = await db.execute(`SELECT id, name, price, image FROM products WHERE id IN (${placeholders})`, productIds);

	const items = products.map((p) => ({
		cart_item_id: null,
		product_id: p.id,
		quantity: Number(guestCart.items[p.id]) || 1,
		name: p.name,
		price: p.price,
		image: p.image,
	}));

	const totalAmount = items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0);

	return { isGuest: true, items, totalAmount };
}

async function mergeGuestCartToUserCart(req) {
	if (!req.session.guestCart || !req.session.guestCart.items) return;

	const userId = req.session.user?.id;
	if (!userId) return;

	const cartId = await ensureUserCartId(userId);

	const items = req.session.guestCart.items; // { productId: qty }
	const productIds = Object.keys(items);

	for (const pid of productIds) {
		const productId = Number(pid);
		const qty = Math.max(1, Number(items[pid]) || 1);

		const [exist] = await db.execute('SELECT id FROM cart_items WHERE cart_id = ? AND product_id = ? LIMIT 1', [cartId, productId]);

		if (exist.length) {
			await db.execute('UPDATE cart_items SET quantity = quantity + ? WHERE id = ?', [qty, exist[0].id]);
		} else {
			await db.execute('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)', [cartId, productId, qty]);
		}
	}

	// 병합 후 비우기
	req.session.guestCart = { items: {} };
}

module.exports = {
	getGuestCart,
	ensureUserCartId,
	getCartViewData,
	mergeGuestCartToUserCart,
};
