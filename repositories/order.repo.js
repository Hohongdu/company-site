const db = require('../db');

const OrderRepo = {
  // Admin: find all orders with user info + defensive COALESCE
  findAll: async () => {
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
               ORDER BY o.created_at DESC`
      );
    } catch (_) {
      [orders] = await db.execute(
        `SELECT o.id,
                CONCAT('ORD-', o.id) AS order_number,
                o.status, 0 AS total_amount, o.created_at,
                '' AS guest_name, '' AS guest_email, '' AS guest_phone,
                NULL AS user_name, NULL AS user_email
               FROM orders o ORDER BY o.id DESC`
      );
    }

    // Enrich with payment info (safe - order_payments may not exist)
    try {
      const [payments] = await db.execute(
        `SELECT op1.order_id, op1.provider, op1.status AS payment_status
                FROM order_payments op1
                JOIN (SELECT order_id, MAX(id) AS max_id FROM order_payments GROUP BY order_id) latest
                ON latest.max_id = op1.id`
      );
      const payMap = new Map(payments.map((p) => [p.order_id, p]));
      orders = orders.map((o) => ({
        ...o,
        payment_provider: payMap.get(o.id)?.provider || null,
        payment_status: payMap.get(o.id)?.payment_status || null,
      }));
    } catch (_) {
      orders = orders.map((o) => ({ ...o, payment_provider: null, payment_status: null }));
    }
    return orders;
  },

  // Find order by order_number with items and payment
  findByNumber: async (orderNumber) => {
    const [[order]] = await db.execute('SELECT * FROM orders WHERE order_number = ? LIMIT 1', [orderNumber]);
    if (!order) return null;

    const [items] = await db.execute(
      `SELECT id, order_id, product_id, product_name, product_spec, product_image, unit_price, quantity, total_price FROM order_items WHERE order_id = ? ORDER BY id ASC`,
      [order.id]
    );

    const [[payment]] = await db.execute(
      `SELECT id, order_id, provider, tid, status, amount, requested_at, approved_at FROM order_payments WHERE order_id = ? ORDER BY id DESC LIMIT 1`,
      [order.id]
    );

    return { order, items, payment };
  },

  // Admin: find order by order_number with user info
  findByNumberAdmin: async (orderNumber) => {
    const [[order]] = await db.execute(
      `SELECT o.*, u.name AS user_name, u.email AS user_email FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.order_number = ? LIMIT 1`,
      [orderNumber]
    );
    if (!order) return null;

    const [items] = await db.execute('SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC', [order.id]);
    const [[payment]] = await db.execute('SELECT * FROM order_payments WHERE order_id = ? ORDER BY id DESC LIMIT 1', [order.id]);

    return { order, items, payment };
  },

  // Find orders for a user
  findByUserId: async (userId) => {
    const [rows] = await db.execute(
      `SELECT id, order_number, status, total_amount, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC`,
      [userId]
    );
    return rows;
  },

  // Recent orders for dashboard
  findRecent: async (limit = 5) => {
    const [rows] = await db.execute(
      `SELECT o.id, COALESCE(o.order_number, CONCAT('ORD-', o.id)) AS order_number, o.status, o.total_amount, o.created_at, u.name AS user_name, o.guest_name FROM orders o LEFT JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC LIMIT ?`,
      [limit]
    );
    return rows;
  },

  // Monthly stats for dashboard chart
  findMonthlySince: async (months = 5) => {
    const [rows] = await db.execute(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym, COUNT(*) AS cnt, COALESCE(SUM(total_amount), 0) AS revenue FROM orders WHERE created_at >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL ? MONTH), '%Y-%m-01') GROUP BY ym ORDER BY ym ASC`,
      [months]
    );
    return rows;
  },

  // Count all orders
  count: async () => {
    const [[row]] = await db.execute('SELECT COUNT(*) AS cnt FROM orders');
    return Number(row.cnt);
  },

  // This month revenue
  thisMonthRevenue: async () => {
    const [[row]] = await db.execute(
      `SELECT COALESCE(SUM(total_amount),0) AS rev FROM orders WHERE status IN ('PAID','PROCESSING','SHIPPED','DELIVERED') AND DATE_FORMAT(created_at,'%Y-%m') = DATE_FORMAT(CURDATE(),'%Y-%m')`
    );
    return Number(row?.rev || 0);
  },

  // Update status
  updateStatus: async (orderNumber, status) => {
    await db.execute('UPDATE orders SET status = ? WHERE order_number = ?', [status, orderNumber]);
  },

  // Update status by ID
  updateStatusById: async (orderId, status) => {
    await db.execute('UPDATE orders SET status = ? WHERE id = ?', [status, orderId]);
  },
};

module.exports = OrderRepo;
