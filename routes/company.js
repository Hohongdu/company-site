const express = require('express');
const db = require('../db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

// 서버 시작 시 1회 실행 — 매 요청마다 ALTER TABLE 반복 방지
(async () => {
	try {
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
		await db.execute(`ALTER TABLE notices ADD COLUMN category VARCHAR(30) NOT NULL DEFAULT 'general'`).catch((err) => {
			if (!String(err?.message || '').includes('Duplicate column')) throw err;
		});
		console.log('[company] 스키마 초기화 완료');
	} catch (err) {
		console.error('[company] 스키마 초기화 실패:', err);
	}
})();

router.get('/', (req, res) => res.render('company/index'));
router.get('/about', (req, res) => res.render('company/about'));
router.get('/history', (req, res) => res.render('company/history'));
router.get('/contact', (req, res) =>
	res.render('company/contact', {
		contactEmail:
			process.env.CONTACT_EMAIL ||
			process.env.EMAIL_TO ||
			process.env.EMAIL_FROM ||
			'contact@example.com',
	}),
);

router.get('/notices', async (req, res) => {
	try {
		const q = String(req.query.q || '').trim();
		const typeParam = String(req.query.type || 'all');
		const allowedTypes = new Set(['all', 'general', 'product']);
		const type = allowedTypes.has(typeParam) ? typeParam : 'all';
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
		console.error('[공지 목록]', err);
		return res.status(500).render('500', { message: '공지 목록을 불러오는 중 오류가 발생했습니다.' });
	}
});

router.get('/notices/:id', async (req, res) => {
	try {
		const noticeId = Number(req.params.id);
		if (!noticeId) return res.status(404).render('404', { message: '공지 없음' });

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
		console.error('[공지 상세]', err);
		return res.status(500).render('500', { message: '공지 상세를 불러오는 중 오류가 발생했습니다.' });
	}
});

router.get('/account', requireLogin, (req, res) =>
	res.render('company/account', { user: req.session.user }),
);

module.exports = router;
