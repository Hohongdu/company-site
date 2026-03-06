const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('../db');
const { mergeGuestCartToUserCart } = require('../lib/cart');
const { sendTemporaryPasswordEmail } = require('../services/notification.service');

const router = express.Router();

const sanitizeReturnTo = (value) => {
	if (typeof value !== 'string') return '';
	const trimmed = value.trim();
	if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '';
	if (trimmed.startsWith('/auth')) return '';
	return trimmed;
};

router.get('/login', (req, res) => {
	const returnTo = sanitizeReturnTo(req.query.redirect);

	// csurf가 걸린 상태라면 req.csrfToken() 사용 가능
	return res.render('auth/login', {
		returnTo,
		csrfToken: req.csrfToken(),
	});
});
router.get('/forgot', (req, res) => {
	return res.render('auth/forgot', {
		csrfToken: req.csrfToken(),
		message: null,
	});
});

function generateTemporaryPassword(length = 12) {
	return crypto
		.randomBytes(length)
		.toString('base64')
		.replace(/[^a-zA-Z0-9]/g, '')
		.slice(0, length);
}

router.post('/forgot', async (req, res) => {
	const successMessage = '요청이 접수되었습니다. 가입된 이메일이라면 임시 비밀번호를 발송했습니다.';

	try {
		const email = String(req.body.email || '').trim().toLowerCase();
		if (!email) {
			return res.status(400).render('auth/forgot', {
				csrfToken: req.csrfToken(),
				message: '이메일 주소를 입력해 주세요.',
			});
		}

		const [rows] = await db.execute('SELECT id, name, email FROM users WHERE email = ? LIMIT 1', [email]);
		if (rows.length > 0) {
			const user = rows[0];
			const temporaryPassword = generateTemporaryPassword(12);
			const hashedPw = await bcrypt.hash(temporaryPassword, 10);
			await db.execute('UPDATE users SET password = ? WHERE id = ?', [hashedPw, user.id]);

			const emailResult = await sendTemporaryPasswordEmail({
				to: user.email,
				userName: user.name,
				temporaryPassword,
			});

			if (emailResult.status === 'FAILED') {
				console.error('[auth/forgot] temporary password mail failed:', emailResult.error);
			}
		}

		return res.render('auth/forgot', {
			csrfToken: req.csrfToken(),
			message: successMessage,
		});
	} catch (err) {
		console.error(err);
		return res.status(500).render('auth/forgot', {
			csrfToken: req.csrfToken(),
			message: '요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
		});
	}
});
router.get('/register', (req, res) => res.render('auth/register'));

router.post('/register', async (req, res) => {
	try {
		const { name, email, password, passwordConfirm } = req.body;
		if (password !== passwordConfirm) return res.send('비밀번호가 일치하지 않습니다.');

		const hashedPw = await bcrypt.hash(password, 10);

		// ✅ is_admin 기본 0 (컬럼 추가된 상태 기준)
		await db.execute('INSERT INTO users (name, email, password, is_admin) VALUES (?, ?, ?, 0)', [name, email, hashedPw]);

		return res.redirect('/auth/login');
	} catch (err) {
		console.error(err);
		return res.status(500).send('회원가입 중 오류 발생');
	}
});

router.post('/login', async (req, res) => {
	try {
		const { email, password } = req.body;

		// ✅ is_admin 포함해서 가져오기
		const [rows] = await db.execute('SELECT id, name, email, password, is_admin FROM users WHERE email = ? LIMIT 1', [email]);
		if (rows.length === 0) return res.send('존재하지 않는 이메일입니다.');

		const user = rows[0];
		const ok = await bcrypt.compare(password, user.password);
		if (!ok) return res.send('비밀번호가 일치하지 않습니다.');

		req.session.user = {
			id: user.id,
			name: user.name,
			email: user.email,
			is_admin: Number(user.is_admin) || 0,
		};

		// 게스트 장바구니 병합
		await mergeGuestCartToUserCart(req);

		const returnTo = sanitizeReturnTo(req.body.returnTo);
		return res.redirect(returnTo || '/account');
	} catch (err) {
		console.error(err);
		return res.status(500).send('로그인 중 오류');
	}
});

router.get('/logout', (req, res) => {
	req.session.destroy((err) => {
		if (err) console.error(err);
		res.clearCookie('connect.sid');
		return res.redirect('/');
	});
});

module.exports = router;
