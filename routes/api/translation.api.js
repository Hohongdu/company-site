const express = require('express');
const router = express.Router();
const translationController = require('../../controllers/translation.controller');

router.post('/', translationController.translate);

module.exports = router;
