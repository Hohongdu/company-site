const express = require('express');
const db = require('../db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

async function ensureNoticesTable() {
	await db.execute(
		`CREATE TABLE IF NOT EXISTS notices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      content TEXT NOT NULL,
      category VARCHAR(30) NOT NULL DEFAULT 'general',
      views INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
	);
}

async function ensureNoticeCategoryColumn() {
	try {
		await db.execute(`ALTER TABLE notices ADD COLUMN category VARCHAR(30) NOT NULL DEFAULT 'general'`);
	} catch (err) {
		if (!String(err?.message || '').includes('Duplicate column')) throw err;
	}
}

router.get('/', (req, res) => res.render('company/index'));
router.get('/about', (req, res) => res.render('company/about'));
router.get('/history', (req, res) => res.render('company/history'));
router.get('/contact', (req, res) => res.render('company/contact'));

router.get('/notices', async (req, res) => {
	try {
		const q = String(req.query.q || '').trim();
		const typeParam = String(req.query.type || 'all');
		const allowedTypes = new Set(['all', 'general', 'product']);
		const type = allowedTypes.has(typeParam) ? typeParam : 'all';
		await ensureNoticesTable();
		await ensureNoticeCategoryColumn();
		const [notices] = await db.execute(
			`SELECT id, title, category, created_at, views
       FROM notices
       WHERE (? = '' OR title LIKE ?)
         AND category IN ('general', 'product')
         AND (? = 'all' OR category = ?)
       ORDER BY created_at DESC`,
			[q, `%${q}%`, type, type],
		);
		return res.render('company/notices', { notices, query: q, type });
	} catch (err) {
		console.error(err);
		return res.status(500).send('공지 목록 로딩 오류');
	}
});

router.get('/notices/:id', async (req, res) => {
	try {
		const noticeId = Number(req.params.id);
		if (!noticeId) return res.status(404).render('404', { message: '공지 없음' });

		await ensureNoticesTable();
		await ensureNoticeCategoryColumn();
		await db.execute('UPDATE notices SET views = views + 1 WHERE id = ?', [noticeId]);
		const [[notice]] = await db.execute(
			`SELECT id, title, content, category, created_at, views
       FROM notices
       WHERE id = ?
       LIMIT 1`,
			[noticeId],
		);

		if (!notice) return res.status(404).render('404', { message: '공지 없음' });
		return res.render('company/notice-detail', { notice });
	} catch (err) {
		console.error(err);
		return res.status(500).send('공지 상세 로딩 오류');
	}
});

router.get('/account', requireLogin, (req, res) =>
	res.render('company/account', { user: req.session.user }),
);

module.exports = router;
