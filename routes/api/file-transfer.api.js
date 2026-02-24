const express = require('express');
const controller = require('../../controllers/file-transfer.controller');

const router = express.Router();

router.post('/', controller.uploadMiddleware, controller.createTransfer);
router.get('/download', controller.download);

module.exports = router;
