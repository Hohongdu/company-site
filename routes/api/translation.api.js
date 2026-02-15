const express = require('express');
const router = express.Router();
const translationController = require('../../controllers/translation.controller');

router.get('/status', translationController.status);
router.post('/', translationController.translate);

module.exports = router;
