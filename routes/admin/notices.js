const express = require('express');
const csurf = require('../../lib/csurf');
const db = require('../../db');
const { ensureNoticesTable, ensureNoticeCategoryColumn } = require('../../lib/migrations');
const asyncHandler = require('../../lib/asyncHandler');

const router = express.Router();
const csrfProtection = csurf({ ignoreMethods: ['GET', 'HEAD', 'OPTIONS'] });

/* =========================
   공지 관리
========================= */
router.get('/notices', asyncHandler(async (req, res) => {
	await ensureNoticesTable();
	await ensureNoticeCategoryColumn();
	const [notices] = await db.execute(
		`SELECT id, title, category, created_at, views
       FROM notices
       ORDER BY created_at DESC`,
	);

	return res.render('admin/notices', { notices, csrfToken: req.csrfToken() });
}));

router.post('/notices', csrfProtection, asyncHandler(async (req, res) => {
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
}));

router.post('/notices/:id/delete', csrfProtection, asyncHandler(async (req, res) => {
	const noticeId = Number(req.params.id);
	if (!noticeId) return res.redirect('/admin/notices');

	await db.execute('DELETE FROM notices WHERE id = ?', [noticeId]);
	return res.redirect('/admin/notices');
}));

module.exports = router;
