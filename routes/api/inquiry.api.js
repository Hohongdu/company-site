const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const inquiryController = require('../../controllers/inquiry.controller');
const { requireAdmin } = require('../../middleware/auth');

// [C-5 보안수정] GET /api/inquiry — 모든 문의 목록(이름/이메일/내용 포함)은 관리자만 접근 가능
// 인증 없이 노출 시 전체 고객 PII(이름, 이메일, 문의 내용)가 공개됨
router.get('/', requireAdmin, inquiryController.list);

// [H-3] 문의 스팸 방지: 1시간 내 IP당 5회 초과 시 차단
// 과다 제출 시 이메일 알림 과금 및 DB 플러딩 방지
const inquiryLimiter = rateLimit({
	windowMs: 60 * 60 * 1000,
	max: 5,
	standardHeaders: 'draft-7',
	legacyHeaders: false,
	message: { ok: false, message: '문의 제출 횟수가 너무 많습니다. 1시간 후 다시 시도해주세요.' },
});

// 문의 등록은 비로그인도 허용 (공개 문의 폼)
router.post('/', inquiryLimiter, inquiryController.create);

module.exports = router;
