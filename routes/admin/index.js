const express = require('express');
const { requireAdmin } = require('../../middleware/auth');
const csurf = require('../../lib/csurf');

const router = express.Router();
router.use(requireAdmin);

// Sub-routers
router.use('/', require('./dashboard'));
router.use('/', require('./notices'));
router.use('/', require('./products'));
router.use('/', require('./orders'));
router.use('/', require('./inquiries'));

module.exports = router;
