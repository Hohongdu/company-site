const express = require('express');
const csurf = require('../../lib/csurf');
const db = require('../../db');
const { ensureNoticesTable, ensureNoticeCategoryColumn } = require('../../lib/migrations');

const router = express.Router();
const csrfProtection = csurf({ ignoreMethods: ['GET', 'HEAD', 'OPTIONS'] });

/* =========================
   공지 관리
========================= */
router.get('/notices', async (req, res) => {
	try {
		await ensureNoticesTable();
		await ensureNoticeCategoryColumn();
		const [notices] = await db.execute(
			`SELECT id, title, category, created_at, views
       FROM notices
       ORDER BY created_at DESC`,
		);

		return res.render('admin/notices', { notices, csrfToken: req.csrfToken() });
	} catch (err) {
		console.error(err);
		return res.status(500).send('공지 목록 로딩 오류');
	}
});

router.post('/notices', csrfProtection, async (req, res) => {
	try {
		const title = String(req.body.title || '').trim();
		const content = String(req.body.content || '').trim();
		const category = String(req.body.category || 'general').trim();
		const allowed = new Set(['general', 'product', 'event']);
		const safeCategory = allowed.has(category) ? category : 'general';

		if (!title || !content) {
			return res.status(400).send('공지 제목과 내용을 입력해주세요.');
		}

		await ensureNoticesTable();
		await ensureNoticeCategoryColumn();
		await db.execute(`INSERT INTO notices (title, content, category) VALUES (?, ?, ?)`, [
			title,
			content,
			safeCategory,
		]);

		return res.redirect('/admin/notices');
	} catch (err) {
		console.error(err);
		return res.status(500).send('공지 등록 오류');
	}
});

router.post('/notices/:id/delete', csrfProtection, async (req, res) => {
	try {
		const noticeId = Number(req.params.id);
		if (!noticeId) return res.redirect('/admin/notices');

		await db.execute('DELETE FROM notices WHERE id = ?', [noticeId]);
		return res.redirect('/admin/notices');
	} catch (err) {
		console.error(err);
		return res.status(500).send('공지 삭제 오류');
	}
});

module.exports = router;
