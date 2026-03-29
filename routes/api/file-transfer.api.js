const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireLogin } = require('../../middleware/auth');
const controller = require('../../controllers/file-transfer.controller');

const router = express.Router();

// [M-1] 파일 업로드 DoS 방지: 1시간 내 10회 초과 시 차단
const fileTransferLimiter = rateLimit({
	windowMs: 60 * 60 * 1000,
	max: 10,
	standardHeaders: 'draft-7',
	legacyHeaders: false,
	message: { ok: false, message: '파일 전송 요청 횟수가 너무 많습니다. 1시간 후 다시 시도해주세요.' },
});

// [H-5] 인증 필수: 비인증 사용자의 무제한 파일 업로드 차단
router.post('/', requireLogin, fileTransferLimiter, controller.uploadMiddleware, controller.createTransfer);
router.get('/download', controller.download);

module.exports = router;
