const express = require('express');
const db = require('../db');
const { requireLogin } = require('../middleware/auth');
const { sendMail } = require('../services/email.service');
const asyncHandler = require('../lib/asyncHandler');

const router = express.Router();

function escapeHtml(str) {
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#x27;');
}

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

router.get('/', (req, res) => res.render('company/index', {
	metaDescription: 'ENERMADE - 고객 맞춤형 세라믹 솔루션 전문기업. SiC, Si₃N₄ 정밀 세라믹 가공부터 대량 생산까지 책임집니다.',
}));
router.get('/about', (req, res) => res.render('company/about', {
	metaDescription: 'ENERMADE 회사 소개 - 세라믹 가공 전문기업의 기술력, 설비, 팀을 소개합니다.',
}));
router.get('/history', (req, res) => res.render('company/history', {
	metaDescription: 'ENERMADE 연혁 - 설립부터 현재까지의 주요 성장 과정을 소개합니다.',
}));
const contactEmail =
	process.env.CONTACT_EMAIL || process.env.EMAIL_TO || process.env.EMAIL_FROM || '';

router.get('/contact', (req, res) =>
	res.render('company/contact', {
		contactEmail,
		success: req.query.ok === '1',
		error: req.query.err || null,
	}),
);

router.post('/contact', async (req, res) => {
	const name = String(req.body.name || '').trim().slice(0, 100);
	const email = String(req.body.email || '').trim().slice(0, 200);
	const message = String(req.body.message || '').trim().slice(0, 5000);

	if (!name || !email || !message) {
		return res.redirect('/contact?err=모든+항목을+입력해주세요.');
	}

	const toAddr = contactEmail;
	if (!toAddr) {
		return res.redirect('/contact?err=이메일+수신+설정이+없습니다.+전화로+문의해주세요.');
	}

	const html = `
<h3>[문의] ${escapeHtml(name)}</h3>
<p><strong>이름:</strong> ${escapeHtml(name)}</p>
<p><strong>이메일:</strong> ${escapeHtml(email)}</p>
<hr>
<p><strong>문의 내용:</strong></p>
<pre style="white-space:pre-wrap">${escapeHtml(message)}</pre>
`;

	const result = await sendMail({
		to: toAddr,
		subject: `[ENERMADE 문의] ${name}`,
		html,
	});

	if (!result.ok && result.status !== 'DISABLED') {
		console.error('[contact] email failed:', result.error);
		return res.redirect('/contact?err=이메일+발송+중+오류가+발생했습니다.+잠시+후+다시+시도해주세요.');
	}

	return res.redirect('/contact?ok=1');
});

router.get('/notices', asyncHandler(async (req, res) => {
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
}));

router.get('/notices/:id', asyncHandler(async (req, res) => {
	const noticeId = Number(req.params.id);
	if (!noticeId) return res.status(404).render('404', { message: '공지 없음' });

	await ensureNoticesTable();
	await ensureNoticeCategoryColumn();

	// H-9: 존재 확인 먼저, 이후 조회수 증가 (없는 공지에 조회수 올라가는 현상 방지)
	const [[notice]] = await db.execute(
		`SELECT id, title, content, category, created_at, views
       FROM notices
       WHERE id = ?
       LIMIT 1`,
		[noticeId],
	);

	if (!notice) return res.status(404).render('404', { message: '공지 없음' });

	await db.execute('UPDATE notices SET views = views + 1 WHERE id = ?', [noticeId]);
	return res.render('company/notice-detail', { notice });
}));

router.get('/account', requireLogin, (req, res) =>
	res.render('company/account', { user: req.session.user }),
);

module.exports = router;
