const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { mergeGuestCartToUserCart } = require('../lib/cart');
const { sendTemporaryPasswordEmail } = require('../services/notification.service');

const router = express.Router();

const MIN_PASSWORD_LENGTH = 8;

// H-2: 로그인 브루트포스 방지 — 15분 내 20회
const loginLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 20,
	message: '잠시 후 다시 시도해주세요.',
	standardHeaders: true,
	legacyHeaders: false,
});

// H-1: 비밀번호 찾기 남용 방지 — 1시간 내 5회
const forgotLimiter = rateLimit({
	windowMs: 60 * 60 * 1000,
	max: 5,
	message: '잠시 후 다시 시도해주세요.',
	standardHeaders: true,
	legacyHeaders: false,
});

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


router.post('/forgot', forgotLimiter, async (req, res) => {
	const SUCCESS_MSG = '입력하신 이메일 주소로 임시 비밀번호가 전송되었습니다. 이메일을 확인해주세요.';

	try {
		const email = String(req.body.email || '').trim().toLowerCase();
		if (!email) {
			return res.status(400).render('auth/forgot', {
				csrfToken: req.csrfToken(),
				message: '이메일 주소를 입력해 주세요.',
				messageType: 'error',
			});
		}

		// 1) 사용자 조회 (없어도 동일한 성공 메시지: 이메일 존재 여부 노출 방지)
		const [[user]] = await db.execute(
			'SELECT id, name, email FROM users WHERE email = ? LIMIT 1',
			[email],
		);

		if (!user) {
			// 보안: 계정 존재 여부를 알려주지 않음
			return res.render('auth/forgot', {
				csrfToken: req.csrfToken(),
				message: SUCCESS_MSG,
				messageType: 'success',
			});
		}

		// 2) 임시 비밀번호 생성 (숫자+영문 대소문자 10자리)
		const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
		const tempPassword = Array.from(
			{ length: 10 },
			() => chars[Math.floor(Math.random() * chars.length)],
		).join('');

		// 3) bcrypt 해싱 후 DB 업데이트
		const hashed = await bcrypt.hash(tempPassword, 10);
		await db.execute('UPDATE users SET password = ? WHERE id = ?', [hashed, user.id]);

		// 4) 이메일 발송 (실패해도 사용자에게 성공 메시지 - 임시 비밀번호는 이미 변경됨)
		const emailResult = await sendTemporaryPasswordEmail({
			to: email,
			name: user.name,
			tempPassword,
		});

		if (!emailResult.ok) {
			console.warn(`[forgot] Email send failed for ${email}:`, emailResult.error);
		}

		return res.render('auth/forgot', {
			csrfToken: req.csrfToken(),
			message: SUCCESS_MSG,
			messageType: 'success',
		});
	} catch (err) {
		console.error(err);
		return res.status(500).render('auth/forgot', {
			csrfToken: req.csrfToken(),
			message: '요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
			messageType: 'error',
		});
	}
});
router.get('/register', (req, res) => res.render('auth/register'));

router.post('/register', async (req, res) => {
	try {
		const name = String(req.body.name || '').trim();
		const email = String(req.body.email || '').trim().toLowerCase();
		const password = String(req.body.password || '');
		const passwordConfirm = String(req.body.passwordConfirm || '');

		// M-1: 빈 값 검증
		if (!name || !email || !password) {
			return res.status(400).render('auth/register', { error: '모든 항목을 입력해주세요.' });
		}

		// H-6: 비밀번호 최소 길이
		if (password.length < MIN_PASSWORD_LENGTH) {
			return res.status(400).render('auth/register', { error: `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.` });
		}

		if (password !== passwordConfirm) {
			return res.status(400).render('auth/register', { error: '비밀번호가 일치하지 않습니다.' });
		}

		const hashedPw = await bcrypt.hash(password, 10);

		// ✅ is_admin 기본 0 (컬럼 추가된 상태 기준)
		await db.execute('INSERT INTO users (name, email, password, is_admin) VALUES (?, ?, ?, 0)', [name, email, hashedPw]);

		return res.redirect('/auth/login');
	} catch (err) {
		console.error(err);
		return res.status(500).send('회원가입 중 오류 발생');
	}
});

router.post('/login', loginLimiter, async (req, res) => {
	try {
		const email = String(req.body.email || '').trim().toLowerCase();
		const password = String(req.body.password || '');

		const renderLoginError = (msg) =>
			res.status(401).render('auth/login', {
				returnTo: req.body.returnTo || '',
				csrfToken: req.csrfToken(),
				error: msg,
			});

		// ✅ is_admin 포함해서 가져오기
		const [rows] = await db.execute('SELECT id, name, email, password, is_admin FROM users WHERE email = ? LIMIT 1', [email]);

		// M-2: User Enumeration 방지 — 동일 메시지로 통일
		if (rows.length === 0) {
			return renderLoginError('이메일 또는 비밀번호가 올바르지 않습니다.');
		}

		const user = rows[0];
		const ok = await bcrypt.compare(password, user.password);
		if (!ok) return renderLoginError('이메일 또는 비밀번호가 올바르지 않습니다.');

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
