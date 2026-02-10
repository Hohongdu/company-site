const express = require('express');
const router = express.Router();

router.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

router.use('/auth', require('./auth.api'));
router.use('/inquiry', require('./inquiry.api'));
router.use('/products', require('./product.api'));
router.use('/translate', require('./translate.api'));

module.exports = router;
