const express = require('express');
const router = express.Router();

// 임시 로그인 엔드포인트 (나중에 구현)
router.post('/login', (req, res) => {
	res.json({ ok: false, message: 'auth not implemented' });
});

module.exports = router;
