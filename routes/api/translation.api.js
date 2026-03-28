const express = require('express');
const router = express.Router();
const translationController = require('../../controllers/translation.controller');
const { requireLogin } = require('../../middleware/auth');

// GET /status — 번역 API 상태 확인: 로그인 필요 (서버 설정 정보 노출 방지)
router.get('/status', requireLogin, translationController.status);

// POST / — 번역 실행: MED-7: 로그인 필요 (Papago 쿼터 무단 소모 방지)
// 이전에는 인증 없이 서버 측 Papago API 키로 누구나 번역 가능했음
router.post('/', requireLogin, translationController.translate);

module.exports = router;
