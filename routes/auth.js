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

	return res.render('auth/login', {
		returnTo,
		csrfToken: req.csrfToken(),
		query: req.query,
	});
});
router.get('/forgot', (req, res) => {
	return res.render('auth/forgot', {
		csrfToken: req.csrfToken(),
		message: null,
	});
});


router.post('/forgot', async (req, res) => {
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

		// 2) 임시 비밀번호 생성 — Math.random() 대신 crypto.randomInt 사용 (암호학적으로 안전)
		const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
		const tempPassword = Array.from(
			{ length: 10 },
			() => chars[crypto.randomInt(chars.length)],
		).join('');

		// 3) 이메일 먼저 발송 — 성공한 경우에만 DB 업데이트 (실패 시 계정 잠금 방지)
		const emailResult = await sendTemporaryPasswordEmail({
			to: email,
			name: user.name,
			tempPassword,
		});

		if (!emailResult.ok) {
			// 이메일 발송 실패 → DB는 변경하지 않음. 기존 비밀번호 유지.
			console.warn(`[forgot] Email send failed for ${email}:`, emailResult.error);
			// 보안상 성공 메시지 반환 (이메일 존재 여부 노출 방지)
			return res.render('auth/forgot', {
				csrfToken: req.csrfToken(),
				message: SUCCESS_MSG,
				messageType: 'success',
			});
		}

		// 4) 이메일 발송 성공 후에만 DB 업데이트
		const hashed = await bcrypt.hash(tempPassword, 10);
		await db.execute('UPDATE users SET password = ? WHERE id = ?', [hashed, user.id]);

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
		const { name, email, password, passwordConfirm } = req.body;

		// 입력값 기본 검증
		if (!name || name.trim().length < 2 || name.trim().length > 50)
			return res.send('이름은 2자 이상 50자 이하로 입력해주세요.');
		if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
			return res.send('올바른 이메일 주소를 입력해주세요.');
		if (!password || password.length < 8 || password.length > 72)
			return res.send('비밀번호는 8자 이상 72자 이하로 입력해주세요.');
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
		if (rows.length === 0) {
			return res.render('auth/login', {
				returnTo: sanitizeReturnTo(req.body.returnTo),
				csrfToken: req.csrfToken(),
				error: '이메일 또는 비밀번호가 올바르지 않습니다.',
			});
		}

		const user = rows[0];
		const ok = await bcrypt.compare(password, user.password);
		if (!ok) {
			return res.render('auth/login', {
				returnTo: sanitizeReturnTo(req.body.returnTo),
				csrfToken: req.csrfToken(),
				error: '이메일 또는 비밀번호가 올바르지 않습니다.',
			});
		}

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
		return res.render('auth/login', {
			returnTo: sanitizeReturnTo(req.body.returnTo),
			csrfToken: req.csrfToken(),
			error: '로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
		});
	}
});

router.get('/logout', (req, res) => {
	req.session.destroy((err) => {
		if (err) console.error(err);
		res.clearCookie('sid');
		return res.redirect('/');
	});
});

module.exports = router;
