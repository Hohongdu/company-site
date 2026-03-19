const db = require('../db');

const ProductRepo = {
  // From admin.js - get product list with optional filters
  findAll: async ({ categoryId, minPrice, maxPrice, stockStatus, visibility } = {}) => {
    const filters = [];
    const params = [];
    if (categoryId) { filters.push('p.category_id = ?'); params.push(categoryId); }
    if (minPrice !== null && minPrice !== undefined) { filters.push('p.price >= ?'); params.push(minPrice); }
    if (maxPrice !== null && maxPrice !== undefined) { filters.push('p.price <= ?'); params.push(maxPrice); }
    if (visibility && visibility !== 'all') { filters.push('p.visibility_status = ?'); params.push(visibility); }
    if (stockStatus === 'out') { filters.push('COALESCE(p.stock_quantity, 0) <= 0'); }
    else if (stockStatus === 'low') { filters.push('COALESCE(p.stock_quantity, 0) BETWEEN 1 AND 5'); }
    else if (stockStatus === 'in') { filters.push('COALESCE(p.stock_quantity, 0) > 5'); }
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const [rows] = await db.execute(
      `SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id ${whereClause} ORDER BY p.id DESC`,
      params
    );
    return rows;
  },

  // From shop.js - visible products for shop with optional category/search filter
  findVisible: async ({ categorySlug, q } = {}) => {
    let sql = `SELECT p.*, c.name AS category_name, c.slug AS category_slug FROM products p LEFT JOIN categories c ON p.category_id = c.id`;
    const params = [];
    const where = ["p.visibility_status <> 'HIDDEN'"];
    if (categorySlug && categorySlug !== 'all') { where.push('c.slug = ?'); params.push(categorySlug); }
    if (q) { where.push('(p.name LIKE ? OR p.code LIKE ? OR p.spec LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    sql += ` WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC`;
    const [rows] = await db.execute(sql, params);
    return rows;
  },

  // Find single product by ID (visible only)
  findById: async (productId) => {
    const [rows] = await db.execute(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ? AND p.visibility_status <> 'HIDDEN' LIMIT 1`,
      [productId]
    );
    return rows[0] || null;
  },

  // Find product by ID for admin (any visibility)
  findByIdAdmin: async (productId) => {
    const [[row]] = await db.execute('SELECT * FROM products WHERE id = ?', [productId]);
    return row || null;
  },

  // Find latest N visible products
  findLatest: async (limit = 8) => {
    const [rows] = await db.execute(
      `SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.visibility_status <> 'HIDDEN' ORDER BY p.created_at DESC LIMIT ?`,
      [limit]
    );
    return rows;
  },

  // Insert new product
  create: async ({ code, name, description, price, spec, image, imageThumb, categoryId, stockQuantity }) => {
    const [result] = await db.execute(
      `INSERT INTO products (code, name, description, price, spec, image, image_thumb, category_id, stock_quantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [code || null, name, description || null, Number(price) || 0, spec || null, image, imageThumb, categoryId || null, Number(stockQuantity) || 0]
    );
    return result.insertId;
  },

  // Update product
  update: async (productId, { code, name, description, price, spec, image, imageThumb, categoryId, stockQuantity }) => {
    await db.execute(
      `UPDATE products SET code=?, name=?, description=?, price=?, spec=?, image=?, image_thumb=?, category_id=?, stock_quantity=? WHERE id=?`,
      [code || null, name, description || null, Number(price) || 0, spec || null, image, imageThumb, categoryId || null, Number(stockQuantity) || 0, productId]
    );
  },

  // Delete product
  delete: async (productId) => {
    await db.execute('DELETE FROM cart_items WHERE product_id = ?', [productId]);
    await db.execute('DELETE FROM products WHERE id = ?', [productId]);
  },

  // Bulk delete
  bulkDelete: async (productIds) => {
    const placeholders = productIds.map(() => '?').join(',');
    await db.execute(`DELETE FROM cart_items WHERE product_id IN (${placeholders})`, productIds);
    await db.execute(`DELETE FROM products WHERE id IN (${placeholders})`, productIds);
  },

  // Update visibility
  updateVisibility: async (productId, status) => {
    await db.execute('UPDATE products SET visibility_status = ? WHERE id = ?', [status, productId]);
  },

  // Update stock
  updateStock: async (productId, quantity) => {
    await db.execute('UPDATE products SET stock_quantity = ? WHERE id = ?', [quantity, productId]);
  },

  // Check code duplicate
  findByCode: async (code) => {
    const [rows] = await db.execute('SELECT id FROM products WHERE code = ? LIMIT 1', [code]);
    return rows[0] || null;
  },

  // Low stock for dashboard
  findLowStock: async (threshold = 5) => {
    const [rows] = await db.execute(
      `SELECT id, name, code, stock_quantity FROM products WHERE stock_quantity IS NOT NULL AND stock_quantity <= ? AND stock_quantity >= 0 ORDER BY stock_quantity ASC LIMIT 10`,
      [threshold]
    );
    return rows;
  },

  // Related products
  findRelated: async (categoryId, excludeId, limit = 4) => {
    const [rows] = await db.execute(
      `SELECT id, name, price, image FROM products WHERE category_id <=> ? AND id <> ? ORDER BY created_at DESC LIMIT ?`,
      [categoryId, excludeId, limit]
    );
    return rows;
  },

  // Export all
  exportAll: async (categoryId = null) => {
    let sql = `SELECT p.id, p.code, p.name, c.name AS category_name, p.price, p.spec, p.image, p.description, p.created_at FROM products p LEFT JOIN categories c ON c.id = p.category_id`;
    const params = [];
    if (categoryId) { sql += ' WHERE p.category_id = ?'; params.push(categoryId); }
    sql += ' ORDER BY p.id DESC';
    const [rows] = await db.execute(sql, params);
    return rows;
  },

  // Get reviews for a product
  findReviews: async (productId) => {
    const [rows] = await db.execute(
      `SELECT r.*, u.name AS user_name FROM product_reviews r LEFT JOIN users u ON u.id = r.user_id WHERE r.product_id = ? ORDER BY r.created_at DESC`,
      [productId]
    );
    return rows;
  },

  // Get review stats
  getReviewStats: async (productId) => {
    const [[stats]] = await db.execute(
      `SELECT COUNT(*) AS review_count, AVG(rating) AS avg_rating FROM product_reviews WHERE product_id = ?`,
      [productId]
    );
    return stats;
  },

  // Add review
  addReview: async (productId, userId, rating, content) => {
    await db.execute(
      `INSERT INTO product_reviews (product_id, user_id, rating, content) VALUES (?, ?, ?, ?)`,
      [productId, userId, rating, content]
    );
  },
};

module.exports = ProductRepo;
