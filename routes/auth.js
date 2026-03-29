const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { mergeGuestCartToUserCart } = require('../lib/cart');
const { sendTemporaryPasswordEmail } = require('../services/notification.service');

const router = express.Router();

// [M-1] 로그인 브루트포스 방지: 15분 내 20회 초과 시 차단
const loginLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 20,
	standardHeaders: 'draft-7',
	legacyHeaders: false,
	handler: (req, res) => {
		res.status(429).render('auth/login', {
			returnTo: '',
			csrfToken: req.csrfToken ? req.csrfToken() : '',
			query: req.query,
			error: '로그인 시도 횟수가 너무 많습니다. 15분 후 다시 시도해주세요.',
		});
	},
});

// [M-1] 비밀번호 찾기 스팸 방지: 1시간 내 5회 초과 시 차단
const forgotLimiter = rateLimit({
	windowMs: 60 * 60 * 1000,
	max: 5,
	standardHeaders: 'draft-7',
	legacyHeaders: false,
	message: { error: '요청 횟수가 너무 많습니다. 1시간 후 다시 시도해주세요.' },
	handler: (req, res) => {
		res.render('auth/forgot', {
			csrfToken: req.csrfToken ? req.csrfToken() : '',
			message: '요청 횟수가 너무 많습니다. 1시간 후 다시 시도해주세요.',
		});
	},
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
		// [H-2] Math.random() → crypto.randomInt(): CSPRNG 사용으로 예측 불가 보장
		// Math.random은 결정론적 PRNG — 시드를 알면 출력 예측 가능
		const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
		const tempPassword = Array.from(
			{ length: 10 },
			() => chars[crypto.randomInt(chars.length)], // Node.js 14.10+ 지원
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

router.post('/login', loginLimiter, async (req, res) => {
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

		// [C-2] 세션 고정 공격(Session Fixation) 방지
		// 로그인 전/후 동일한 세션 ID를 유지하면, 공격자가 미리 심어둔 세션 ID로
		// 인증된 세션을 탈취할 수 있음. regenerate()로 새 세션 ID 발급 필수.
		//
		// regenerate 전에 게스트 장바구니를 백업: regenerate는 세션 데이터를 초기화함.
		const savedGuestCart = req.session.guestCart ? { ...req.session.guestCart } : null;
		const returnTo = sanitizeReturnTo(req.body.returnTo);

		// regenerate를 Promise로 래핑 (async/await 호환)
		await new Promise((resolve, reject) =>
			req.session.regenerate(err => (err ? reject(err) : resolve())),
		);

		// 새 세션에 사용자 정보 설정
		req.session.user = {
			id: user.id,
			name: user.name,
			email: user.email,
			is_admin: Number(user.is_admin) || 0,
		};

		// 게스트 장바구니 복원 (regenerate로 초기화됐으므로)
		if (savedGuestCart) {
			req.session.guestCart = savedGuestCart;
		}

		// 새 세션용 CSRF 토큰 재발급
		req.session.csrfToken = crypto.randomBytes(16).toString('hex');

		// 게스트 장바구니 → 사용자 장바구니 병합
		await mergeGuestCartToUserCart(req);

		return res.redirect(returnTo || '/account');
	} catch (err) {
		console.error('[login error]', err);
		return res.render('auth/login', {
			returnTo: sanitizeReturnTo(req.body.returnTo),
			csrfToken: req.session?.csrfToken || '',
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
