const db = require('../db');

const NoticeRepo = {
  findAll: async () => {
    const [rows] = await db.execute(`SELECT id, title, category, created_at, views FROM notices ORDER BY created_at DESC`);
    return rows;
  },

  findPublished: async (category = null) => {
    let sql = 'SELECT * FROM notices';
    const params = [];
    if (category) { sql += ' WHERE category = ?'; params.push(category); }
    sql += ' ORDER BY created_at DESC';
    const [rows] = await db.execute(sql, params);
    return rows;
  },

  findById: async (id) => {
    const [[row]] = await db.execute('SELECT * FROM notices WHERE id = ? LIMIT 1', [id]);
    return row || null;
  },

  create: async ({ title, content, category }) => {
    const [result] = await db.execute(
      'INSERT INTO notices (title, content, category) VALUES (?, ?, ?)',
      [title, content, category]
    );
    return result.insertId;
  },

  delete: async (id) => {
    await db.execute('DELETE FROM notices WHERE id = ?', [id]);
  },

  incrementViews: async (id) => {
    await db.execute('UPDATE notices SET views = views + 1 WHERE id = ?', [id]);
  },
};

module.exports = NoticeRepo;
