const express = require('express');
const router = express.Router();

// 임시 상품 API
router.get('/', (req, res) => {
	res.json({ ok: true, items: [] });
});

module.exports = router;
