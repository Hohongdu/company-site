/**
 * order.service.js — 주문 생성 및 조회 비즈니스 로직
 */
const db = require('../db');
const { getCartViewData } = require('../lib/cart');
const { ensureOrderShippingColumns } = require('../lib/migrations');

/**
 * 주문 번호 생성
 */
function generateOrderNumber() {
	const rand = Math.floor(Math.random() * 1000)
		.toString()
		.padStart(3, '0');
	return `ORD-${Date.now()}-${rand}`;
}

/**
 * 장바구니에서 주문 생성
 * @param {import('express').Request} req
 * @param {{ guestName, guestEmail, guestPhone, shippingName, shippingPhone, shippingAddress, discountAmount, couponCode }} options
 */
async function createOrderFromCart(req, { guestName, guestEmail, guestPhone, shippingName, shippingPhone, shippingAddress, discountAmount, couponCode }) {
	const data = await getCartViewData(req);

	if (!data.items.length || !data.totalAmount) {
		return { error: '결제할 상품이 없습니다.' };
	}

	await ensureOrderShippingColumns();

	const orderNumber = generateOrderNumber();
	const userId = req.session.user?.id || null;
	const discount = Number(discountAmount) || 0;
	const finalAmount = Math.max(0, data.totalAmount - discount);

	const connection = await db.getConnection();
	try {
		await connection.beginTransaction();

		const [orderResult] = await connection.execute(
			`INSERT INTO orders
        (order_number, user_id, guest_name, guest_email, guest_phone, status, total_amount, shipping_name, shipping_phone, shipping_address, discount_amount, coupon_code)
        VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)`,
			[orderNumber, userId, guestName || null, guestEmail || null, guestPhone || null, finalAmount, shippingName || null, shippingPhone || null, shippingAddress || null, discount, couponCode || null],
		);

		const orderId = orderResult.insertId;
		const insertItemSql = `
        INSERT INTO order_items
          (order_id, product_id, product_name, product_spec, product_image, unit_price, quantity, total_price)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;

		for (const item of data.items) {
			const quantity = Number(item.quantity) || 1;
			const unitPrice = Number(item.price) || 0;
			await connection.execute(insertItemSql, [
				orderId,
				item.product_id,
				item.name,
				item.spec || null,
				item.image || null,
				unitPrice,
				quantity,
				unitPrice * quantity,
			]);
		}

		await connection.commit();
		return { orderId, orderNumber, items: data.items, totalAmount: finalAmount };
	} catch (err) {
		await connection.rollback();
		throw err;
	} finally {
		connection.release();
	}
}

/**
 * 주문번호로 주문 상세 조회
 * @param {string} orderNumber
 */
async function fetchOrderDetailByNumber(orderNumber) {
	const [[order]] = await db.execute('SELECT * FROM orders WHERE order_number = ? LIMIT 1', [orderNumber]);
	if (!order) return null;

	const [items] = await db.execute(
		`SELECT id, order_id, product_id, product_name, product_spec, product_image, unit_price, quantity, total_price
     FROM order_items
     WHERE order_id = ?
     ORDER BY id ASC`,
		[order.id],
	);

	const [[payment]] = await db.execute(
		`SELECT id, order_id, provider, tid, status, amount, requested_at, approved_at
     FROM order_payments
     WHERE order_id = ?
     ORDER BY id DESC
     LIMIT 1`,
		[order.id],
	);

	return { order, items, payment };
}

module.exports = { generateOrderNumber, createOrderFromCart, fetchOrderDetailByNumber };
