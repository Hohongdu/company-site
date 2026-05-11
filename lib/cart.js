// lib/cart.js
const db = require('../db');

// 게스트 장바구니(세션) 구조:
// req.session.guestCart = { items: { [productId]: quantity } }
function getGuestCart(req) {
	if (!req.session.guestCart) req.session.guestCart = { items: {} };
	return req.session.guestCart;
}

async function ensureUserCartId(userId) {
	// [M-6] INSERT ... ON DUPLICATE KEY: 동시 요청 레이스 컨디션으로 중복 cart 행 생성 방지
	// carts.user_id에 UNIQUE 제약이 있다는 전제 하에 안전하게 upsert
	await db.execute(
		'INSERT INTO carts (user_id) VALUES (?) ON DUPLICATE KEY UPDATE user_id = user_id',
		[userId],
	);
	const [rows] = await db.execute('SELECT id FROM carts WHERE user_id = ? LIMIT 1', [userId]);
	return rows[0].id;
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

	const items = req.session.guestCart.items; // { productId: qty }
	const productIds = Object.keys(items);
	if (!productIds.length) return;

	// [CODEX-3] 빈 게스트 카트는 조기 종료 — ensureUserCartId 호출 및 빈 carts 행 생성 방지
	if (productIds.length === 0) return;

	const cartId = await ensureUserCartId(userId);

	// [CODEX-2] 트랜잭션으로 병합: 중간 실패 시 이미 병합된 아이템이 세션에 잔류해 재로그인 시 수량 중복 누적되는 문제 방지
	const connection = await db.getConnection();
	try {
		await connection.beginTransaction();

		for (const pid of productIds) {
			const productId = Number(pid);
			// [HIGH-1] 수량 상한 999 적용 (게스트 카트 병합 시에도 동일하게 적용)
			const qty = Math.min(999, Math.max(1, Number(items[pid]) || 1));

			const [exist] = await connection.execute(
				'SELECT id, quantity FROM cart_items WHERE cart_id = ? AND product_id = ? LIMIT 1',
				[cartId, productId]
			);

			if (exist.length) {
				// 기존 수량 + 게스트 수량이 999를 초과하지 않도록 클램프
				const newQty = Math.min(999, exist[0].quantity + qty);
				await connection.execute(
					'UPDATE cart_items SET quantity = ? WHERE id = ?',
					[newQty, exist[0].id]
				);
			} else {
				await connection.execute(
					'INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)',
					[cartId, productId, qty],
				);
			}
		}

		await connection.commit();
		// 모든 상품 병합 성공 후에만 세션 초기화
		req.session.guestCart = { items: {} };
	} catch (err) {
		await connection.rollback();
		console.error('[cart-merge] 트랜잭션 롤백:', err.message);
		// 세션은 그대로 유지 — 다음 로그인 시 재시도 가능
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
