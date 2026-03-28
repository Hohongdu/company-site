const express = require('express');
const router = express.Router();
const inquiryController = require('../../controllers/inquiry.controller');
const { requireLogin, requireAdmin } = require('../../middleware/auth');

// POST / — 문의 생성: 로그인 사용자만 허용 (비회원 문의는 company 라우터에서 별도 처리)
router.post('/', requireLogin, inquiryController.create);

// GET / — 문의 목록: CRIT-7: 관리자 전용 (전체 고객 PII 노출 방지)
// 이전에는 인증 없이 모든 문의 목록(이름·이메일·메시지)이 공개되어 있었음
router.get('/', requireAdmin, inquiryController.list);

module.exports = router;
