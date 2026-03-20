const express = require('express');
const csurf = require('../../lib/csurf');
const db = require('../../db');
const asyncHandler = require('../../lib/asyncHandler');

const router = express.Router();
const csrfProtection = csurf({ ignoreMethods: ['GET', 'HEAD', 'OPTIONS'] });

/* =========================
   주문 관리
========================= */
router.get('/orders', asyncHandler(async (req, res) => {
	// 1) 기본 주문 목록 조회 (order_number, total_amount 컬럼 없을 수 있으므로 COALESCE 사용)
	let orders = [];
	try {
		[orders] = await db.execute(
			`SELECT o.id,
                COALESCE(o.order_number, CONCAT('ORD-', o.id)) AS order_number,
                o.status,
                COALESCE(o.total_amount, 0) AS total_amount,
                o.created_at,
                COALESCE(o.guest_name, '')  AS guest_name,
                COALESCE(o.guest_email, '') AS guest_email,
                COALESCE(o.guest_phone, '') AS guest_phone,
                u.name  AS user_name,
                u.email AS user_email
               FROM orders o
               LEFT JOIN users u ON u.id = o.user_id
               ORDER BY o.created_at DESC`,
		);
	} catch (q1Err) {
		console.error('[admin/orders] 주문 쿼리 오류:', q1Err.message);
		// 최소 컬럼만으로 재시도
		[orders] = await db.execute(
			`SELECT o.id,
                CONCAT('ORD-', o.id) AS order_number,
                o.status, 0 AS total_amount, o.created_at,
                '' AS guest_name, '' AS guest_email, '' AS guest_phone,
                NULL AS user_name, NULL AS user_email
               FROM orders o ORDER BY o.id DESC`,
		);
	}

	// 2) 결제 정보 별도 조회 (order_payments 테이블 없어도 안전)
	try {
		const [payments] = await db.execute(
			`SELECT op1.order_id, op1.provider, op1.status AS payment_status
                FROM order_payments op1
                JOIN (SELECT order_id, MAX(id) AS max_id FROM order_payments GROUP BY order_id) latest
                ON latest.max_id = op1.id`,
		);
		const payMap = new Map(payments.map((p) => [p.order_id, p]));
		orders = orders.map((o) => ({
			...o,
			payment_provider: payMap.get(o.id)?.provider || null,
			payment_status: payMap.get(o.id)?.payment_status || null,
		}));
	} catch (_) {
		// order_payments 테이블 없음 — 결제 정보 없이 진행
		orders = orders.map((o) => ({ ...o, payment_provider: null, payment_status: null }));
	}

	return res.render('admin/orders', { orders });
}));

router.post('/orders/:orderNumber/status', csrfProtection, asyncHandler(async (req, res) => {
	const orderNumber = String(req.params.orderNumber || '').trim();
	const allowed = ['PENDING', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELED'];
	const status = String(req.body.status || '').trim();

	if (!allowed.includes(status)) {
		return res.status(400).send('유효하지 않은 상태값입니다.');
	}

	// Expand enum if needed
	try {
		await db.execute(
			`ALTER TABLE orders MODIFY status ENUM('PENDING','PAID','CANCELED','FAILED','CANCEL_REQUESTED','PROCESSING','SHIPPED','DELIVERED') NOT NULL DEFAULT 'PENDING'`,
		);
	} catch (_) {}

	await db.execute('UPDATE orders SET status = ? WHERE order_number = ?', [status, orderNumber]);
	return res.redirect(`/admin/orders/${orderNumber}`);
}));

router.get('/orders/:orderNumber', asyncHandler(async (req, res) => {
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
}));

module.exports = router;
