const express = require('express');
const controller = require('../../controllers/ai.controller');

const router = express.Router();

router.get('/status', controller.status);
router.post('/chat', controller.chat);

module.exports = router;
