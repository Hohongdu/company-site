const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { mergeGuestCartToUserCart } = require('../lib/cart');
const { sendTemporaryPasswordEmail } = require('../services/notification.service');
const { sendMail: sendSmtpMail } = require('../services/smtp-email.service');

const { isValidEmail } = require('../lib/validators');

const router = express.Router();

// 개인정보 보호법 제15조 (구분 동의) 증거 보존용 컬럼 자동 추가
// migrations/2026-05-26-user-consents.sql 의 인라인 구현
async function ensureUserConsentColumns() {
	const cols = [
		{ name: 'terms_agreed_at',     ddl: 'DATETIME NULL COMMENT "이용약관 동의 시각"' },
		{ name: 'privacy_agreed_at',   ddl: 'DATETIME NULL COMMENT "개인정보처리방침 동의 시각"' },
		{ name: 'marketing_agreed_at', ddl: 'DATETIME NULL COMMENT "마케팅 수신 동의 시각 (선택)"' },
		{ name: 'consent_ip',          ddl: 'VARCHAR(64) NULL COMMENT "동의 당시 IP"' },
		{ name: 'consent_user_agent',  ddl: 'VARCHAR(255) NULL COMMENT "동의 당시 User-Agent"' },
	];
	for (const col of cols) {
		try {
			await db.execute(`ALTER TABLE users ADD COLUMN ${col.name} ${col.ddl}`);
		} catch (err) {
			if (!String(err?.message || '').includes('Duplicate column')) throw err;
		}
	}
}

router.initializeSchema = async function initializeSchema() {
	await ensureUserConsentColumns();
};

// [M-1] 로그인 브루트포스 방지: 15분 내 20회 초과 시 차단 (성공 시 카운트 제외)
// keyGenerator 생략 → 라이브러리 기본값(ipKeyGenerator)이 IPv6 안전하게 처리
const loginLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 20,
	skipSuccessfulRequests: true,
	standardHeaders: 'draft-7',
	legacyHeaders: false,
	handler: (req, res) => {
		res.status(429).render('auth/login', {
			returnTo: '',
			csrfToken: req.session?.csrfToken || '',
			query: req.query,
			error: '로그인 시도 횟수가 너무 많습니다. 15분 후 다시 시도해주세요.',
		});
	},
	skip: () => process.env.NODE_ENV === 'test',
});

// [M-2] 회원가입 봇/스팸 방지: 1시간 내 IP당 10회 초과 시 차단
const registerLimiter = rateLimit({
	windowMs: 60 * 60 * 1000,
	max: 10,
	standardHeaders: 'draft-7',
	legacyHeaders: false,
	handler: (req, res) => {
		res.status(429).render('auth/register', {
			error: '가입 시도 횟수가 너무 많습니다. 1시간 후 다시 시도해주세요.',
		});
	},
});

// [M-1] 비밀번호 찾기 스팸 방지: 1시간 내 5회 초과 시 차단
const forgotLimiter = rateLimit({
	windowMs: 60 * 60 * 1000,
	max: 5,
	standardHeaders: 'draft-7',
	legacyHeaders: false,
	handler: (req, res) => {
		res.status(429).render('auth/forgot', {
			csrfToken: req.session?.csrfToken || '',
			message: '요청이 너무 많습니다. 15분 후 다시 시도해주세요.',
			messageType: 'error',
		});
	},
	skip: () => process.env.NODE_ENV === 'test',
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
			// 타이밍 공격 방지: 계정 존재 여부와 무관하게 bcrypt 연산을 수행해 응답 시간을 균일화
			await bcrypt.hash('timing-equalization-dummy', 10);
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

		// [CRIT-2] 이메일 발송을 DB 업데이트보다 먼저 시도
		// 이메일 실패 시 비밀번호를 절대 덮어쓰지 않음 → 공격자의 계정 잠금 공격 차단
		// 3) bcrypt 해싱
		const hashed = await bcrypt.hash(tempPassword, 10);

		// 4) 이메일 발송 먼저 시도
		const emailResult = await sendTemporaryPasswordEmail({
			to: email,
			name: user.name,
			tempPassword,
		});

		if (!emailResult.ok) {
			console.warn(`[forgot] 이메일 발송 실패 — 비밀번호 변경 취소:`, emailResult.error);
			// 이메일 실패 시 DB 업데이트 안 함 (기존 비밀번호 유지)
			return res.render('auth/forgot', {
				csrfToken: req.csrfToken(),
				message: '이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.',
				messageType: 'error',
			});
		}

		// 5) 이메일 성공 확인 후에만 DB 비밀번호 업데이트
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
// [LOW-2] 다른 GET 라우트와 일관되게 csrfToken 명시 전달 — res.locals 미설정 엣지케이스 방어
router.get('/register', (req, res) => res.render('auth/register', {
	csrfToken: req.csrfToken ? req.csrfToken() : (req.session?.csrfToken || ''),
}));

router.post('/register', registerLimiter, async (req, res) => {
	try {
		const { name, email, password, passwordConfirm, agreeTerms, agreePrivacy, agreeMarketing } = req.body;

		// 입력값 기본 검증
		// [LOW-1] 유효성 오류 시 폼 다시 렌더링 (CSRF 토큰 포함) — 기존 bare text 응답 수정
		const renderErr = (msg) => res.status(400).render('auth/register', {
			error: msg,
			csrfToken: req.csrfToken ? req.csrfToken() : (req.session?.csrfToken || ''),
			form: { name, email },
		});

		if (!name || name.trim().length < 2 || name.trim().length > 50)
			return renderErr('이름은 2자 이상 50자 이하로 입력해주세요.');
		if (!email || !isValidEmail(email))
			return renderErr('올바른 이메일 주소를 입력해주세요.');
		if (!password || password.length < 8 || password.length > 72)
			return renderErr('비밀번호는 8자 이상 72자 이하로 입력해주세요.');
		if (!/[a-zA-Z]/.test(password))
			return renderErr('비밀번호에 영문자를 포함해야 합니다.');
		if (!/[0-9]/.test(password))
			return renderErr('비밀번호에 숫자를 포함해야 합니다.');
		if (!/[!@#$%^&*()\-_=+\[\]{};:'",.<>/?\\|`~]/.test(password))
			return renderErr('비밀번호에 특수문자를 포함해야 합니다.');
		if (password !== passwordConfirm) return renderErr('비밀번호가 일치하지 않습니다.');

		// [필수] 약관·개인정보 동의 검증 (개인정보 보호법 제15조)
		// 체크박스는 체크 시에만 req.body에 "1"이 들어오므로 falsy 검증
		if (agreeTerms !== '1') return renderErr('이용약관에 동의해야 회원가입이 가능합니다.');
		if (agreePrivacy !== '1') return renderErr('개인정보 수집·이용에 동의해야 회원가입이 가능합니다.');

		const hashedPw = await bcrypt.hash(password, 10);

		// 동의 기록 — 분쟁 시 증거 (trust proxy로 req.ip는 X-Forwarded-For 기반)
		const now = new Date();
		const marketingAt = agreeMarketing === '1' ? now : null;
		const ip = (req.ip || '').slice(0, 64);
		const ua = String(req.get('user-agent') || '').slice(0, 255);

		await db.execute(
			`INSERT INTO users
			   (name, email, password, is_admin,
			    terms_agreed_at, privacy_agreed_at, marketing_agreed_at,
			    consent_ip, consent_user_agent)
			 VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)`,
			[name, email, hashedPw, now, now, marketingAt, ip, ua],
		);

		// 환영 이메일 발송 (비차단 — 이메일 실패가 회원가입을 막지 않음)
		sendSmtpMail({
			to: email,
			subject: `[ENERMADE] 회원가입을 환영합니다, ${name}님`,
			html: `<h2>안녕하세요, ${name}님!</h2><p>ENERMADE에 가입해 주셔서 감사합니다.</p><p>문의사항은 <a href="${process.env.BASE_URL || 'https://enermade.com'}/contact">고객 지원</a>을 이용해 주세요.</p>`,
		}).catch(err => console.error('[register] welcome email failed:', err));

		return res.redirect('/auth/login');
	} catch (err) {
		console.error(err);
		// [LOW-1b] 서버 오류도 폼 렌더링으로 통일 — 이메일 중복(ER_DUP_ENTRY) 등 DB 오류 시 UX 개선
		const isDupEntry = String(err?.code || err?.message || '').includes('ER_DUP_ENTRY') || String(err?.message || '').includes('Duplicate entry');
		return res.status(500).render('auth/register', {
			error: isDupEntry ? '이미 사용 중인 이메일입니다.' : '회원가입 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
			csrfToken: req.csrfToken ? req.csrfToken() : (req.session?.csrfToken || ''),
			form: { name, email },
		});
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
