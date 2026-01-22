const express = require('express');
const router = express.Router();
const inquiryController = require('../../controllers/inquiry.controller');

router.post('/', inquiryController.create);
router.get('/', inquiryController.list);

module.exports = router;
