const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const { mergeGuestCartToUserCart } = require('../lib/cart');

const router = express.Router();

router.get('/login', (req, res) => res.render('auth/login'));
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

		return res.redirect('/shop');
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
