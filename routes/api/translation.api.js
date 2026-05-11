const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const translationController = require('../../controllers/translation.controller');
const { requireLogin } = require('../../middleware/auth');

// [H-3] 번역 API 남용 방지: 서버 측 Papago API 키 무단 사용/과금 차단
// 1시간 내 IP당 50회 초과 시 차단
const translationLimiter = rateLimit({
	windowMs: 60 * 60 * 1000,
	max: 50,
	standardHeaders: 'draft-7',
	legacyHeaders: false,
	message: { ok: false, message: '번역 요청 횟수가 너무 많습니다. 1시간 후 다시 시도해주세요.' },
});

router.get('/status', translationController.status);
router.post('/', translationLimiter, translationController.translate);

module.exports = router;
