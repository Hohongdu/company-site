const express = require('express');
const router = express.Router();
const inquiryController = require('../../controllers/inquiry.controller');
const { requireAdmin } = require('../../middleware/auth');

// [C-5 보안수정] GET /api/inquiry — 모든 문의 목록(이름/이메일/내용 포함)은 관리자만 접근 가능
// 인증 없이 노출 시 전체 고객 PII(이름, 이메일, 문의 내용)가 공개됨
router.get('/', requireAdmin, inquiryController.list);

// 문의 등록은 비로그인도 허용 (공개 문의 폼)
router.post('/', inquiryController.create);

module.exports = router;
