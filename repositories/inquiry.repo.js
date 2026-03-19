const db = require('../db');

const InquiryRepo = {
  // Admin: find all inquiries with user + order info
  findAll: async () => {
    let inquiries = [];
    try {
      [inquiries] = await db.execute(
        `SELECT i.*,
                COALESCE(o.order_number, IF(i.order_id IS NOT NULL, CONCAT('ORD-', i.order_id), NULL)) AS order_number,
                u.name  AS user_name,
                u.email AS user_email
               FROM inquiries i
               LEFT JOIN orders o ON o.id = i.order_id
               LEFT JOIN users u ON u.id = i.user_id
               ORDER BY i.created_at DESC`
      );
    } catch (_) {
      [inquiries] = await db.execute(
        `SELECT i.*, NULL AS order_number, u.name AS user_name, u.email AS user_email FROM inquiries i LEFT JOIN users u ON u.id = i.user_id ORDER BY i.created_at DESC`
      );
    }
    return inquiries;
  },

  // Find inquiry by ID with user info
  findById: async (inquiryId) => {
    const [[row]] = await db.execute(
      `SELECT i.*, u.name AS user_name, u.email AS user_email FROM inquiries i LEFT JOIN users u ON u.id = i.user_id WHERE i.id = ? LIMIT 1`,
      [inquiryId]
    );
    return row || null;
  },

  // Find by user
  findByUserId: async (userId) => {
    const [rows] = await db.execute(
      `SELECT i.* FROM inquiries i WHERE i.user_id = ? ORDER BY i.created_at DESC`,
      [userId]
    );
    return rows;
  },

  // Count pending inquiries
  countPending: async () => {
    const [[row]] = await db.execute(`SELECT COUNT(*) AS cnt FROM inquiries WHERE status = 'NEW'`);
    return Number(row?.cnt || 0);
  },

  // Monthly stats for dashboard
  findMonthlySince: async (months = 5) => {
    const [rows] = await db.execute(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym, COUNT(*) AS cnt FROM inquiries WHERE created_at >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL ? MONTH), '%Y-%m-01') GROUP BY ym ORDER BY ym ASC`,
      [months]
    );
    return rows;
  },

  // Count all
  count: async () => {
    const [[row]] = await db.execute('SELECT COUNT(*) AS cnt FROM inquiries');
    return Number(row.cnt);
  },

  // Create inquiry
  create: async ({ orderId, userId, guestName, guestEmail, guestPhone, title, content }) => {
    const [result] = await db.execute(
      `INSERT INTO inquiries (order_id, user_id, guest_name, guest_email, guest_phone, title, content, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'NEW')`,
      [orderId, userId || null, guestName, guestEmail, guestPhone, title, content]
    );
    return result.insertId;
  },

  // Reply to inquiry
  reply: async (inquiryId, { answerContent, notificationChannel, notificationStatus, notificationError }) => {
    await db.execute(
      `UPDATE inquiries SET status = 'ANSWERED', answer_content = ?, answered_at = NOW(), notification_channel = ?, notification_status = ?, notification_error = ? WHERE id = ?`,
      [answerContent, notificationChannel, notificationStatus, notificationError, inquiryId]
    );
  },

  // Guest inquiry lookup
  findGuestInquiry: async (inquiryId, guestEmail, guestPhone) => {
    const [[row]] = await db.execute(
      `SELECT * FROM inquiries WHERE id = ? AND user_id IS NULL AND ((guest_email = ? AND guest_email IS NOT NULL) OR (guest_phone = ? AND guest_phone IS NOT NULL)) LIMIT 1`,
      [inquiryId, guestEmail || null, guestPhone || null]
    );
    return row || null;
  },
};

module.exports = InquiryRepo;
